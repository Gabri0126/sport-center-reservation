/* Data Access Object (DAO) module for accessing users data */

import db from './db.mjs';
import crypto from 'crypto';

// Returns user's info given its id (used by passport deserializeUser, indirectly).
const getUserById = (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users WHERE id=?';
    db.get(sql, [id], (err, row) => {
      if (err) reject(err);
      else if (row === undefined) resolve({ error: 'User not found.' });
      else {
        const user = {
          id: row.id, username: row.email, name: row.name,
          secret: row.secret, lastTotpStep: row.lastTotpStep, score: row.score,
        };
        resolve(user);
      }
    });
  });
};

// Used at log-in time to verify username (email) and password.
const getUser = (email, password) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users WHERE email=?';
    db.get(sql, [email], (err, row) => {
      if (err) return reject(err);
      if (row === undefined) return resolve(false);

      const user = {
        id: row.id, username: row.email, name: row.name,
        secret: row.secret, lastTotpStep: row.lastTotpStep, score: row.score,
      };

      // Check the hashes with an async call, this operation may be CPU-intensive
      crypto.scrypt(password, row.salt, 32, (err, hashedPassword) => {
        if (err) return reject(err);
        if (!crypto.timingSafeEqual(Buffer.from(row.hash, 'hex'), hashedPassword))
          resolve(false);
        else
          resolve(user);
      });
    });
  });
};

// Updates lastTotpStep (replay protection) for the user.
const updateLastTotpStep = (userId, lastTotpStep) => {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE users SET lastTotpStep = ? WHERE id = ?';
    db.run(sql, [lastTotpStep, userId], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
};

// Resets the user's score back to 0 (called after a successful TOTP login,
// only if the score was negative).
const resetScore = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE users SET score = 0 WHERE id = ?';
    db.run(sql, [userId], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
};

// Decreases the user's score by 1 (called after a "delete reservation" operation).
const decrementScore = (userId) => {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE users SET score = score - 1 WHERE id = ?';
    db.run(sql, [userId], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
};

export default {
  getUserById,
  getUser,
  updateLastTotpStep,
  resetScore,
  decrementScore,
};

// Alice in Wonderland: "It's no use going back to yesterday, because I was a different person then."
