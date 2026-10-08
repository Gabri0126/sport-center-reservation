/** DB access module **/

import sqlite from 'sqlite3';

// open the database
const db = new sqlite.Database('sport.db', (err) => {
  if (err) throw err;
});

export default db;

// Alice in Wonderland: "Curiouser and curiouser!" cried Alice.
