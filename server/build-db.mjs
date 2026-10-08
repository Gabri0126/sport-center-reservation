/**
 * One-off script used to (re-)create and seed the sport.db SQLite database.
 * Run with: node build-db.mjs
 * (Not part of the running application: the server only reads sport.db.)
 */

import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import fs from 'fs';

const DB_FILE = 'sport.db';
if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

const db = new sqlite3.Database(DB_FILE);

// Same secret for all users, as requested by the exam text (for simplicity),
// but stored separately (one row per user) in the DB, so each user's row is
// independent even though the value happens to be identical for everyone.
const TOTP_SECRET = 'LXBSMDTMSP2I5XFXIYRGFVWSFI';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { hash, salt };
}

const users = [
  { email: 'alice@sport.it', name: 'Alice', password: 'pwd', secret: TOTP_SECRET, score: 0 },   // no reservations
  { email: 'bob@sport.it', name: 'Bob', password: 'pwd', secret: TOTP_SECRET, score: 0 },     // 1 reservation
  { email: 'carol@sport.it', name: 'Carol', password: 'pwd', secret: TOTP_SECRET, score: -1 },  // 1 reservation, negative score
  { email: 'dave@sport.it', name: 'Dave', password: 'pwd', secret: TOTP_SECRET, score: -2 },   // 2 reservations, negative score
];

// facility type -> [count, prefix]
const facilityTypes = [
  { type: 'tennis', count: 3, prefix: 'T' },
  { type: 'basketball', count: 2, prefix: 'B' },
  { type: 'volleyball', count: 2, prefix: 'V' },
  { type: 'soccer', count: 1, prefix: 'S' },
  { type: 'tabletennis', count: 4, prefix: 'P' },
  { type: 'cycling', count: 2, prefix: 'C' },
];

// equipment catalogue: type -> total quantity available in the whole center
const equipment = [
  { type: 'tennis_racket', total: 8 },
  { type: 'tennis_ball', total: 7 },
  { type: 'towel', total: 4 },
  { type: 'basketball', total: 2 },
  { type: 'cone', total: 4 },
  { type: 'volleyball', total: 2 },
  { type: 'knee_pads', total: 10 },
  { type: 'soccer_ball', total: 2 },
  { type: 'soccer_shoes', total: 12 },
  { type: 'goalkeeper_gloves', total: 2 },
  { type: 'tabletennis_racket', total: 8 },
  { type: 'tabletennis_ball', total: 4 },
  { type: 'bicycle', total: 4 },
  { type: 'helmet', total: 4 },
  { type: 'repair_kit', total: 1 },
];

// facility_type -> required equipment: [equipmentType, minQuantity, mandatory]
const facilityEquipment = [
  ['tennis', 'tennis_racket', 2, 1],
  ['tennis', 'tennis_ball', 3, 1],
  ['tennis', 'towel', 0, 0],
  ['basketball', 'basketball', 1, 1],
  ['basketball', 'cone', 0, 0],
  ['volleyball', 'volleyball', 1, 1],
  ['volleyball', 'knee_pads', 0, 0],
  ['soccer', 'soccer_ball', 1, 1],
  ['soccer', 'soccer_shoes', 10, 1],
  ['soccer', 'goalkeeper_gloves', 0, 0],
  ['tabletennis', 'tabletennis_racket', 2, 1],
  ['tabletennis', 'tabletennis_ball', 1, 1],
  ['cycling', 'bicycle', 1, 1],
  ['cycling', 'helmet', 1, 1],
  ['cycling', 'repair_kit', 0, 0],
];

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE users (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    secret TEXT,
    lastTotpStep INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0
  )`);

  db.run(`CREATE TABLE facilities (
    id TEXT NOT NULL PRIMARY KEY,
    type TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1
  )`);

  db.run(`CREATE TABLE equipment (
    type TEXT NOT NULL PRIMARY KEY,
    total INTEGER NOT NULL,
    available INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE facility_equipment (
    facilityType TEXT NOT NULL,
    equipmentType TEXT NOT NULL,
    minQuantity INTEGER NOT NULL DEFAULT 0,
    mandatory INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (facilityType, equipmentType)
  )`);

  db.run(`CREATE TABLE reservations (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user INTEGER NOT NULL,
    facilityId TEXT NOT NULL,
    facilityType TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(user) REFERENCES users(id),
    FOREIGN KEY(facilityId) REFERENCES facilities(id)
  )`);

  db.run(`CREATE TABLE reservation_equipment (
    reservationId INTEGER NOT NULL,
    equipmentType TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (reservationId, equipmentType),
    FOREIGN KEY(reservationId) REFERENCES reservations(id)
  )`);

  // Records the release (deletion) of a reservation, used to enforce the
  // "no re-booking of the same facility type within 30 seconds" rule.
  db.run(`CREATE TABLE releases (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user INTEGER NOT NULL,
    facilityType TEXT NOT NULL,
    releasedAt TEXT NOT NULL,
    FOREIGN KEY(user) REFERENCES users(id)
  )`);

  const errCb = (label) => (err) => { if (err) console.error(label, err); };

  // --- seed users ---
  const userStmt = db.prepare('INSERT INTO users (email, name, hash, salt, secret, lastTotpStep, score) VALUES (?,?,?,?,?,?,?)');
  for (const u of users) {
    const { hash, salt } = hashPassword(u.password);
    userStmt.run(u.email, u.name, hash, salt, u.secret, 0, u.score, errCb('user ' + u.email));
  }
  userStmt.finalize();

  // --- seed equipment ---
  const eqStmt = db.prepare('INSERT INTO equipment (type, total, available) VALUES (?,?,?)');
  for (const e of equipment) eqStmt.run(e.type, e.total, e.total, errCb('equipment ' + e.type));
  eqStmt.finalize();

  // --- seed facility_equipment requirements ---
  const feStmt = db.prepare('INSERT INTO facility_equipment (facilityType, equipmentType, minQuantity, mandatory) VALUES (?,?,?,?)');
  for (const [type, eq, min, mandatory] of facilityEquipment) feStmt.run(type, eq, min, mandatory, errCb('facility_equipment ' + type + '/' + eq));
  feStmt.finalize();

  // --- seed facilities ---
  const facStmt = db.prepare('INSERT INTO facilities (id, type, available) VALUES (?,?,1)');
  for (const ft of facilityTypes) {
    for (let i = 1; i <= ft.count; i++) facStmt.run(`${ft.prefix}${i}`, ft.type, errCb('facility ' + ft.prefix + i));
  }
  facStmt.finalize();

  // --- seed preloaded reservations ---
  // After all preloaded reservations: at least 1 facility of each type still
  // available, and at least 1 unit of each equipment type still available.
  const now = new Date();
  const oldTimestamp = new Date(now.getTime() - 3600 * 1000).toISOString(); // 1h ago, well outside the 30s cooldown window

  function bookFacility(facilityId) {
    db.run('UPDATE facilities SET available = 0 WHERE id = ?', [facilityId]);
  }
  function consumeEquipment(type, qty) {
    db.run('UPDATE equipment SET available = available - ? WHERE type = ?', [qty, type]);
  }
  function createReservation(userEmail, facilityId, facilityType, items, cb) {
    db.get('SELECT id FROM users WHERE email = ?', [userEmail], (err, row) => {
      const userId = row.id;
      db.run('INSERT INTO reservations (user, facilityId, facilityType, createdAt) VALUES (?,?,?,?)',
        [userId, facilityId, facilityType, oldTimestamp], function (err2) {
          if (err2) { console.error('insert reservation error', err2); return; }
          const reservationId = this.lastID;
          const stmt = db.prepare('INSERT INTO reservation_equipment (reservationId, equipmentType, quantity) VALUES (?,?,?)');
          for (const [eqType, qty] of items) {
            stmt.run(reservationId, eqType, qty, (e) => { if (e) console.error('res_equip', reservationId, eqType, e); });
            consumeEquipment(eqType, qty);
          }
          stmt.finalize();
          bookFacility(facilityId);
          if (cb) cb();
        });
    });
  }

  // Bob (score 0): tennis court T1, mandatory equipment + 1 extra optional towel
  createReservation('bob@sport.it', 'T1', 'tennis', [
    ['tennis_racket', 2], ['tennis_ball', 3], ['towel', 1],
  ], () => {
    // Carol (score -1, negative): basketball court B1, minimum mandatory equipment only
    createReservation('carol@sport.it', 'B1', 'basketball', [
      ['basketball', 1],
    ], () => {
      // Dave (score -2, negative): 2 reservations, minimum mandatory equipment only
      createReservation('dave@sport.it', 'V1', 'volleyball', [
        ['volleyball', 1],
      ], () => {
        createReservation('dave@sport.it', 'P1', 'tabletennis', [
          ['tabletennis_racket', 2], ['tabletennis_ball', 1],
        ], () => {
          db.close((err) => {
            if (err) console.error(err);
            else console.log('sport.db created and seeded successfully.');
          });
        });
      });
    });
  });
});

// Alice in Wonderland: "Who in the world am I? Ah, that's the great puzzle!"
