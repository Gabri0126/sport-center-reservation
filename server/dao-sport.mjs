/* Data Access Object (DAO) module for facilities, equipment and reservations */

import db from './db.mjs';
import dayjs from 'dayjs';
import userDao from './dao-users.mjs';

const COOLDOWN_SECONDS = 30;

/*** small promise wrappers around sqlite3 callback API (same pattern used in the labs) ***/
const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

/*** Public overview (no authentication needed) ***/

// Number of facilities of each type, and how many are currently available.
const getFacilitiesOverview = async () => {
  const rows = await all(`SELECT type, COUNT(*) AS total, SUM(available) AS available
                           FROM facilities GROUP BY type ORDER BY type`);
  return rows.map(r => ({ type: r.type, total: r.total, available: r.available }));
};

// Quantity currently available for each equipment type (and total stock).
const getEquipmentOverview = async () => {
  const rows = await all('SELECT type, total, available FROM equipment ORDER BY type');
  return rows;
};

// Mandatory/optional equipment requirements for every facility type
// (used by the client to build the booking form).
const getAllFacilityRequirements = async () => {
  const rows = await all('SELECT facilityType, equipmentType, minQuantity, mandatory FROM facility_equipment');
  const map = {};
  for (const r of rows) {
    if (!map[r.facilityType]) map[r.facilityType] = [];
    map[r.facilityType].push({ equipmentType: r.equipmentType, minQuantity: r.minQuantity, mandatory: !!r.mandatory });
  }
  return map;
};

const getFacilityRequirements = async (facilityType) => {
  const rows = await all('SELECT equipmentType, minQuantity, mandatory FROM facility_equipment WHERE facilityType = ?', [facilityType]);
  return rows.map(r => ({ equipmentType: r.equipmentType, minQuantity: r.minQuantity, mandatory: !!r.mandatory }));
};

const isValidFacilityType = async (facilityType) => {
  const row = await get('SELECT 1 FROM facilities WHERE type = ? LIMIT 1', [facilityType]);
  return !!row;
};

/*** Facility selection (authenticated) ***/

// List of individual facility ids of a given type that are currently free
// (used for "direct selection from a list").
const getAvailableFacilitiesByType = async (facilityType) => {
  const rows = await all('SELECT id FROM facilities WHERE type = ? AND available = 1 ORDER BY id', [facilityType]);
  return rows.map(r => r.id);
};

const getFacility = async (facilityId) => {
  return get('SELECT id, type, available FROM facilities WHERE id = ?', [facilityId]);
};

/*** Cooldown (30 seconds re-booking rule) ***/

const isTooEarlyToRebook = async (userId, facilityType) => {
  const threshold = dayjs().subtract(COOLDOWN_SECONDS, 'second').toISOString();
  const row = await get(
    `SELECT 1 FROM releases WHERE user = ? AND facilityType = ? AND releasedAt > ? LIMIT 1`,
    [userId, facilityType, threshold]
  );
  return !!row;
};

/*** Reservations ***/

// Returns all reservations of a user, each with its list of rented equipment.
const listReservationsForUser = async (userId) => {
  const reservations = await all(
    `SELECT id, facilityId, facilityType, createdAt FROM reservations WHERE user = ? ORDER BY id`,
    [userId]
  );
  for (const r of reservations) {
    r.equipment = await all(
      'SELECT equipmentType, quantity FROM reservation_equipment WHERE reservationId = ? ORDER BY equipmentType',
      [r.id]
    );
  }
  return reservations;
};

const getReservation = async (reservationId) => {
  const reservation = await get(
    'SELECT id, user, facilityId, facilityType, createdAt FROM reservations WHERE id = ?',
    [reservationId]
  );
  if (!reservation) return undefined;
  reservation.equipment = await all(
    'SELECT equipmentType, quantity FROM reservation_equipment WHERE reservationId = ? ORDER BY equipmentType',
    [reservationId]
  );
  return reservation;
};

/**
 * Creates a new reservation.
 * @param userId          id of the requesting (authenticated) user
 * @param userScore       current score of the user (<=0 means restricted mode)
 * @param facilityType    e.g. 'tennis'
 * @param facilityId      specific facility id if "direct selection", null/undefined for automatic assignment
 * @param equipmentRequests  array of { equipmentType, quantity } as requested by the client
 *                           (ignored for mandatory quantities when the user has negative score:
 *                            the server always enforces exactly the minimum in that case)
 * Returns { reservation } on success, or { error: '...' } on failure. No partial writes on failure.
 */
const createReservation = async (userId, userScore, facilityType, facilityId, equipmentRequests) => {
  // 1. facility type must exist
  const requirements = await getFacilityRequirements(facilityType);
  if (requirements.length === 0) return { error: 'Unknown facility type' };

  const restricted = userScore < 0; // negative score => only minimum mandatory equipment allowed

  // 2. build the final equipment quantity map, validating against the rules
  const requested = new Map((equipmentRequests || []).map(e => [e.equipmentType, Number(e.quantity)]));
  const finalQuantities = new Map();

  for (const req of requirements) {
    const clientQty = requested.has(req.equipmentType) ? requested.get(req.equipmentType) : 0;

    if (req.mandatory) {
      if (restricted) {
        finalQuantities.set(req.equipmentType, req.minQuantity); // forced to the minimum only
      } else {
        if (!Number.isInteger(clientQty) || clientQty < req.minQuantity)
          return { error: `Quantity for mandatory equipment "${req.equipmentType}" must be at least ${req.minQuantity}` };
        finalQuantities.set(req.equipmentType, clientQty);
      }
    } else {
      // optional equipment
      if (clientQty > 0) {
        if (restricted)
          return { error: `Users with negative score cannot request optional equipment ("${req.equipmentType}")` };
        if (!Number.isInteger(clientQty))
          return { error: `Invalid quantity for equipment "${req.equipmentType}"` };
        finalQuantities.set(req.equipmentType, clientQty);
      }
    }
  }

  // any requested equipment type not related to this facility type is rejected
  const allowedTypes = new Set(requirements.map(r => r.equipmentType));
  for (const type of requested.keys()) {
    if (!allowedTypes.has(type)) return { error: `Equipment "${type}" is not usable with facility type "${facilityType}"` };
  }

  // 3. 30-second re-booking cooldown
  if (await isTooEarlyToRebook(userId, facilityType))
    return { error: 'Too early to reserve again: wait at least 30 seconds after releasing a facility of this type' };

  // 4. Atomically claim a facility. Using "UPDATE ... WHERE available = 1" (instead
  // of a separate SELECT-then-UPDATE) closes the race window between two
  // concurrent requests: SQLite executes a single UPDATE statement atomically,
  // so only one of two simultaneous claims on the same row can ever succeed
  // (result.changes tells us which). This keeps the whole check-and-claim
  // sequence safe under concurrency without needing a multi-statement
  // transaction.
  const claimFacility = async (id) => {
    const result = await run('UPDATE facilities SET available = 0 WHERE id = ? AND available = 1', [id]);
    return result.changes === 1;
  };

  let chosenFacilityId = facilityId;
  if (chosenFacilityId) {
    const facility = await getFacility(chosenFacilityId);
    if (!facility || facility.type !== facilityType) return { error: 'Facility not found for the selected type' };
    if (!(await claimFacility(chosenFacilityId)))
      return { error: 'Not enough facilities: the selected facility is already reserved' };
  } else {
    const candidates = await getAvailableFacilitiesByType(facilityType);
    chosenFacilityId = null;
    for (const candidateId of candidates) {
      if (await claimFacility(candidateId)) { chosenFacilityId = candidateId; break; }
      // another concurrent request claimed this one first: try the next candidate
    }
    if (!chosenFacilityId) return { error: `Not enough facilities of type "${facilityType}"` };
  }

  // 5. Atomically claim each equipment item, the same way. If any item can't
  // be claimed (ran out, possibly due to a concurrent request), everything
  // already claimed in this call (facility + prior equipment items) is
  // rolled back by hand, since no multi-statement transaction is used.
  const claimEquipment = async (type, qty) => {
    const result = await run('UPDATE equipment SET available = available - ? WHERE type = ? AND available >= ?', [qty, type, qty]);
    return result.changes === 1;
  };

  const claimedEquipment = []; // [{type, qty}] successfully claimed so far, for rollback
  let equipmentError = null;
  for (const [type, qty] of finalQuantities.entries()) {
    if (qty <= 0) continue;
    if (await claimEquipment(type, qty)) {
      claimedEquipment.push([type, qty]);
    } else {
      equipmentError = `Not enough equipment of type "${type}"`;
      break;
    }
  }

  if (equipmentError) {
    for (const [type, qty] of claimedEquipment) await run('UPDATE equipment SET available = available + ? WHERE type = ?', [qty, type]);
    await run('UPDATE facilities SET available = 1 WHERE id = ?', [chosenFacilityId]);
    return { error: equipmentError };
  }

  // 6. all resources successfully claimed: record the reservation
  const now = dayjs().toISOString();
  const result = await run(
    'INSERT INTO reservations (user, facilityId, facilityType, createdAt) VALUES (?,?,?,?)',
    [userId, chosenFacilityId, facilityType, now]
  );
  const reservationId = result.lastID;

  for (const [type, qty] of claimedEquipment) {
    await run('INSERT INTO reservation_equipment (reservationId, equipmentType, quantity) VALUES (?,?,?)', [reservationId, type, qty]);
  }

  return { reservation: await getReservation(reservationId) };
};

/**
 * Modifies an existing reservation: add and/or remove rented equipment.
 * Mandatory equipment can never be lowered below its required minimum, and
 * cannot be removed entirely; optional equipment can be freely added/removed.
 * Users with a negative score follow the same restriction that applies at
 * creation time: they may not *add* optional or additional mandatory
 * equipment (removals, e.g. of equipment kept from before the score went
 * negative, remain allowed down to the mandatory minimum).
 */
const modifyReservationEquipment = async (reservationId, userId, userScore, addList, removeList) => {
  const reservation = await getReservation(reservationId);
  if (!reservation) return { error: 'Reservation not found' };
  if (reservation.user !== userId) return { error: 'Not authorized to modify this reservation' };

  const restricted = userScore < 0;
  if (restricted && (addList || []).length > 0)
    return { error: 'Users with negative score cannot add optional or additional mandatory equipment' };

  const requirements = await getFacilityRequirements(reservation.facilityType);
  const reqByType = new Map(requirements.map(r => [r.equipmentType, r]));
  const allowedTypes = new Set(requirements.map(r => r.equipmentType));

  const current = new Map(reservation.equipment.map(e => [e.equipmentType, e.quantity]));

  // validate requested changes before touching the DB
  for (const { equipmentType, quantity } of (addList || [])) {
    if (!allowedTypes.has(equipmentType)) return { error: `Equipment "${equipmentType}" is not usable with this facility type` };
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: `Invalid quantity to add for "${equipmentType}"` };
  }
  for (const { equipmentType, quantity } of (removeList || [])) {
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: `Invalid quantity to remove for "${equipmentType}"` };
    const req = reqByType.get(equipmentType);
    const currentQty = current.get(equipmentType) || 0;
    const floor = (req && req.mandatory) ? req.minQuantity : 0;
    if (currentQty - quantity < floor)
      return { error: `Cannot remove ${quantity} unit(s) of "${equipmentType}": the mandatory minimum must remain in the reservation` };
  }

  // check availability for additions and apply them atomically (same
  // "UPDATE ... WHERE" pattern as createReservation, to close the race
  // window between two concurrent requests on the shared equipment pool).
  // Additions are applied BEFORE removals so that, if an addition fails
  // partway through, only additions (never removals) need to be rolled
  // back to leave the reservation exactly as it was.
  const claimEquipment = async (type, qty) => {
    const result = await run('UPDATE equipment SET available = available - ? WHERE type = ? AND available >= ?', [qty, type, qty]);
    return result.changes === 1;
  };

  const appliedAdditions = [];
  let additionError = null;
  for (const { equipmentType, quantity } of (addList || [])) {
    if (!(await claimEquipment(equipmentType, quantity))) {
      additionError = `Not enough equipment of type "${equipmentType}"`;
      break;
    }
    const existing = current.get(equipmentType) || 0;
    if (existing > 0) await run('UPDATE reservation_equipment SET quantity = quantity + ? WHERE reservationId = ? AND equipmentType = ?', [quantity, reservationId, equipmentType]);
    else await run('INSERT INTO reservation_equipment (reservationId, equipmentType, quantity) VALUES (?,?,?)', [reservationId, equipmentType, quantity]);
    current.set(equipmentType, existing + quantity);
    appliedAdditions.push({ equipmentType, quantity });
  }

  if (additionError) {
    for (const { equipmentType, quantity } of appliedAdditions) {
      await run('UPDATE reservation_equipment SET quantity = quantity - ? WHERE reservationId = ? AND equipmentType = ?', [quantity, reservationId, equipmentType]);
      await run('UPDATE equipment SET available = available + ? WHERE type = ?', [quantity, equipmentType]);
    }
    return { error: additionError };
  }

  // apply removals (always safe: no availability precondition can fail here)
  for (const { equipmentType, quantity } of (removeList || [])) {
    const newQty = (current.get(equipmentType) || 0) - quantity;
    if (newQty > 0) await run('UPDATE reservation_equipment SET quantity = ? WHERE reservationId = ? AND equipmentType = ?', [newQty, reservationId, equipmentType]);
    else await run('DELETE FROM reservation_equipment WHERE reservationId = ? AND equipmentType = ?', [reservationId, equipmentType]);
    await run('UPDATE equipment SET available = available + ? WHERE type = ?', [quantity, equipmentType]);
    current.set(equipmentType, Math.max(newQty, 0));
  }

  return { reservation: await getReservation(reservationId) };
};

/**
 * Deletes a reservation: restores facility and equipment availability,
 * decreases the user's score by 1 (persisted in the DB, the actual source
 * of truth: the session only ever caches this value for display purposes),
 * and records the release for the 30-second re-booking cooldown.
 */
const deleteReservation = async (reservationId, userId) => {
  const reservation = await getReservation(reservationId);
  if (!reservation) return { error: 'Reservation not found' };
  if (reservation.user !== userId) return { error: 'Not authorized to delete this reservation' };

  for (const item of reservation.equipment) {
    await run('UPDATE equipment SET available = available + ? WHERE type = ?', [item.quantity, item.equipmentType]);
  }
  await run('UPDATE facilities SET available = 1 WHERE id = ?', [reservation.facilityId]);
  await run('DELETE FROM reservation_equipment WHERE reservationId = ?', [reservationId]);
  await run('DELETE FROM reservations WHERE id = ?', [reservationId]);
  await run('INSERT INTO releases (user, facilityType, releasedAt) VALUES (?,?,?)', [userId, reservation.facilityType, dayjs().toISOString()]);

  // Persist the score decrease in the DB (this is the authoritative value;
  // any in-session copy is only a cache and must be refreshed from here).
  await userDao.decrementScore(userId);
  const updatedUser = await userDao.getUserById(userId);

  return { success: true, score: updatedUser.score };
};

export default {
  getFacilitiesOverview,
  getEquipmentOverview,
  getAllFacilityRequirements,
  getFacilityRequirements,
  isValidFacilityType,
  getAvailableFacilitiesByType,
  listReservationsForUser,
  getReservation,
  createReservation,
  modifyReservationEquipment,
  deleteReservation,
};

// Alice in Wonderland: "Would you tell me, please, which way I ought to go from here?"
