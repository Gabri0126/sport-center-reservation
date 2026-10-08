/*** Importing modules ***/
import express from 'express';
import morgan from 'morgan';                                  // logging middleware
import { check, validationResult, oneOf } from 'express-validator'; // validation middleware
import cors from 'cors';

/** Authentication-related imports **/
import passport from 'passport';                              // authentication middleware
import LocalStrategy from 'passport-local';                    // authentication strategy (username and password)
import session from 'express-session';
import { TOTP } from 'otpauth';

import userDao from './dao-users.mjs';
import sportDao from './dao-sport.mjs';

/*** init express and set-up the middlewares ***/
const app = express();
app.use(morgan('dev'));
app.use(express.json());

/** Set up and enable Cross-Origin Resource Sharing (CORS): multiple-server pattern **/
const corsOptions = {
  origin: 'http://localhost:5173',
  credentials: true,
};
app.use(cors(corsOptions));

/*** Passport: local strategy (username/password) ***/
passport.use(new LocalStrategy(async function verify(username, password, callback) {
  const user = await userDao.getUser(username, password);
  if (!user) return callback(null, false, 'Incorrect username or password');
  return callback(null, user); // user info stored in the session
}));

passport.serializeUser(function (user, callback) {
  callback(null, user);
});
passport.deserializeUser(function (user, callback) {
  return callback(null, user); // will be available in req.user
});

/** Session **/
app.use(session({
  secret: "shhhhh... it's a secret! - change it for the real exam submission!",
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.authenticate('session'));

/*** TOTP (2FA) verification ***/
function verifyTotpToken(user, token) {
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: user.secret,
  });

  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return false; // invalid code

  const currentCounter = totp.counter();
  const actualStep = currentCounter + delta;

  if (actualStep <= user.lastTotpStep) return false; // reject replay / older step

  user.lastTotpStep = actualStep;
  return true;
}

/** Authentication verification middlewares **/
const isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Not authenticated' });
};

const isTotp = (req, res, next) => {
  if (req.session.method === 'totp') return next();
  return res.status(401).json({ error: 'Missing TOTP authentication' });
};

// This function is used to format express-validator errors as strings
const errorFormatter = ({ location, msg, param, value, nestedErrors }) => {
  return `${location}[${param}]: ${msg}`;
};

function clientUserInfo(req) {
  const user = req.user;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    score: user.score,
    canDoTotp: user.secret ? true : false,
    isTotp: req.session.method === 'totp',
  };
}

/* ===================== Public overview APIs (no authentication) ===================== */

// GET /api/facilities
// Number of facilities of each type, and how many are currently available.
app.get('/api/facilities', async (req, res) => {
  try {
    const overview = await sportDao.getFacilitiesOverview();
    res.json(overview);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/equipment
// Total and currently available quantity for each equipment type.
app.get('/api/equipment', async (req, res) => {
  try {
    const overview = await sportDao.getEquipmentOverview();
    res.json(overview);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/facility-requirements
// For each facility type, the list of required (mandatory/optional) equipment
// with the mandatory minimum quantities. Used to build the booking form.
app.get('/api/facility-requirements', async (req, res) => {
  try {
    const requirements = await sportDao.getAllFacilityRequirements();
    res.json(requirements);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ===================== Authentication APIs ===================== */

// POST /api/sessions - login with username (email) and password
app.post('/api/sessions',
  [
    check('username').isEmail(),
    check('password').isLength({ min: 1 }),
  ],
  function (req, res, next) {
    const errors = validationResult(req).formatWith(errorFormatter);
    if (!errors.isEmpty()) return res.status(422).json({ error: errors.array().join(', ') });

    passport.authenticate('local', (err, user, info) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: info });
      req.login(user, (err) => {
        if (err) return next(err);
        return res.json(clientUserInfo(req));
      });
    })(req, res, next);
  }
);

// POST /api/login-totp - second factor authentication
app.post('/api/login-totp', isLoggedIn,
  [ check('code').isLength({ min: 6, max: 6 }).isNumeric() ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(errorFormatter);
    if (!errors.isEmpty()) return res.status(422).json({ error: errors.array().join(', ') });

    if (!req.user.secret) return res.status(400).json({ error: 'Cannot authenticate with TOTP' });

    const success = verifyTotpToken(req.user, req.body.code);
    if (!success) return res.status(401).json({ error: 'Cannot authenticate with TOTP' });

    try {
      req.session.method = 'totp';
      await userDao.updateLastTotpStep(req.user.id, req.user.lastTotpStep);
      // The negative score goes back to zero if the user opts for the TOTP procedure at login.
      if (req.user.score < 0) {
        await userDao.resetScore(req.user.id);
        req.user.score = 0;
      }
      return res.json(clientUserInfo(req));
    } catch (err) {
      console.log(err);
      return res.status(503).json({ error: 'Database error' });
    }
  }
);

// GET /api/sessions/current - check whether the user is logged in
app.get('/api/sessions/current', (req, res) => {
  if (req.isAuthenticated()) res.status(200).json(clientUserInfo(req));
  else res.status(401).json({ error: 'Not authenticated' });
});

// DELETE /api/sessions/current - logout
app.delete('/api/sessions/current', (req, res) => {
  req.logout(() => {
    res.status(200).json({});
  });
});

/* ===================== Facility selection (authenticated) ===================== */

// GET /api/facilities/:type/available - list of specific facility ids of a
// given type that are currently free (for direct selection).
app.get('/api/facilities/:type/available', isLoggedIn,
  [ check('type').isString().notEmpty() ],
  async (req, res) => {
    try {
      const valid = await sportDao.isValidFacilityType(req.params.type);
      if (!valid) return res.status(404).json({ error: 'Unknown facility type' });
      const ids = await sportDao.getAvailableFacilitiesByType(req.params.type);
      res.json(ids);
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: 'Database error' });
    }
  }
);

/* ===================== Reservations (authenticated) ===================== */

// GET /api/reservations - list of the current user's reservations
app.get('/api/reservations', isLoggedIn, async (req, res) => {
  try {
    const reservations = await sportDao.listReservationsForUser(req.user.id);
    res.json(reservations);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/reservations - create a new reservation
// body: { facilityType, facilityId (optional, for direct selection), equipment: [{equipmentType, quantity}] }
app.post('/api/reservations', isLoggedIn,
  [
    check('facilityType').isString().notEmpty(),
    check('facilityId').optional({ nullable: true }).isString(),
    // DESIGN NOTE: only checked as an array here; each item's shape
    // (equipmentType/quantity) is validated inside dao-sport.createReservation
    // instead, together with the actual business rules (mandatory minimums,
    // score restrictions, etc.). Keeping detailed content validation in the
    // business-logic layer avoids duplicating those rules here.
    check('equipment').isArray(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(errorFormatter);
    if (!errors.isEmpty()) return res.status(422).json({ error: errors.array().join(', ') });

    try {
      const result = await sportDao.createReservation(
        req.user.id,
        req.user.score,
        req.body.facilityType,
        req.body.facilityId || null,
        req.body.equipment
      );
      if (result.error) return res.status(409).json({ error: result.error });
      res.status(201).json(result.reservation);
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: 'Database error' });
    }
  }
);

// PUT /api/reservations/:id - modify equipment of an existing reservation
// body: { addEquipment: [{equipmentType, quantity}], removeEquipment: [{equipmentType, quantity}] }
app.put('/api/reservations/:id', isLoggedIn,
  [
    check('id').isInt({ min: 1 }),
    check('addEquipment').optional().isArray(),
    check('removeEquipment').optional().isArray(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(errorFormatter);
    if (!errors.isEmpty()) return res.status(422).json({ error: errors.array().join(', ') });

    try {
      const result = await sportDao.modifyReservationEquipment(
        Number(req.params.id),
        req.user.id,
        req.user.score,
        req.body.addEquipment || [],
        req.body.removeEquipment || []
      );
      if (result.error) return res.status(409).json({ error: result.error });
      res.json(result.reservation);
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: 'Database error' });
    }
  }
);

// DELETE /api/reservations/:id - delete a reservation
app.delete('/api/reservations/:id', isLoggedIn,
  [ check('id').isInt({ min: 1 }) ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(errorFormatter);
    if (!errors.isEmpty()) return res.status(422).json({ error: errors.array().join(', ') });

    try {
      const result = await sportDao.deleteReservation(Number(req.params.id), req.user.id);
      if (result.error) return res.status(409).json({ error: result.error });
      // The score was decremented and persisted in the DB inside deleteReservation.
      // We only refresh the in-session cached copy so the navbar badge stays correct
      // for the rest of this session; the DB row is already the source of truth.
      req.user.score = result.score;
      res.status(200).json({});
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: 'Database error' });
    }
  }
);

// Activating the server
const PORT = 3001;
app.listen(PORT, (err) => {
  if (err) console.log(err);
  else console.log(`Server listening at http://localhost:${PORT}`);
});

// Alice in Wonderland: "We're all mad here."
