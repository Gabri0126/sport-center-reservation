const SERVER_URL = 'http://localhost:3001/api/';

/**
 * A utility function for parsing the HTTP response.
 * The server always returns JSON; in case of error the format is { error: <message> }.
 */
function getJson(httpResponsePromise) {
  return new Promise((resolve, reject) => {
    httpResponsePromise
      .then((response) => {
        if (response.ok) {
          response.json()
            .then(json => resolve(json))
            .catch(() => reject({ error: 'Cannot parse server response' }));
        } else {
          response.json()
            .then(obj => reject(obj))
            .catch(() => reject({ error: 'Cannot parse server response' }));
        }
      })
      .catch(() => reject({ error: 'Cannot communicate with the server' }));
  });
}

/*** Public overview ***/

const getFacilities = async () => {
  return getJson(fetch(SERVER_URL + 'facilities'));
};

const getEquipment = async () => {
  return getJson(fetch(SERVER_URL + 'equipment'));
};

const getFacilityRequirements = async () => {
  return getJson(fetch(SERVER_URL + 'facility-requirements'));
};

/*** Facility selection ***/

const getAvailableFacilities = async (facilityType) => {
  return getJson(fetch(SERVER_URL + 'facilities/' + facilityType + '/available', { credentials: 'include' }));
};

/*** Authentication ***/

const logIn = async (credentials) => {
  return getJson(fetch(SERVER_URL + 'sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(credentials),
  }));
};

const totpVerify = async (code) => {
  return getJson(fetch(SERVER_URL + 'login-totp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  }));
};

const getUserInfo = async () => {
  return getJson(fetch(SERVER_URL + 'sessions/current', { credentials: 'include' }));
};

const logOut = async () => {
  return getJson(fetch(SERVER_URL + 'sessions/current', {
    method: 'DELETE',
    credentials: 'include',
  }));
};

/*** Reservations ***/

const getReservations = async () => {
  return getJson(fetch(SERVER_URL + 'reservations', { credentials: 'include' }));
};

const createReservation = async (facilityType, facilityId, equipment) => {
  return getJson(fetch(SERVER_URL + 'reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ facilityType, facilityId, equipment }),
  }));
};

const modifyReservation = async (id, addEquipment, removeEquipment) => {
  return getJson(fetch(SERVER_URL + 'reservations/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ addEquipment, removeEquipment }),
  }));
};

const deleteReservation = async (id) => {
  return getJson(fetch(SERVER_URL + 'reservations/' + id, {
    method: 'DELETE',
    credentials: 'include',
  }));
};

const API = {
  getFacilities, getEquipment, getFacilityRequirements, getAvailableFacilities,
  logIn, totpVerify, getUserInfo, logOut,
  getReservations, createReservation, modifyReservation, deleteReservation,
};
export default API;

// Alice in Wonderland: "If you don't know where you are going, any road will get you there."
