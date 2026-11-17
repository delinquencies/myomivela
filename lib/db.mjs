// The SQLite database: connection, ordered migrations, query helpers and transactions.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.mjs';
import { requireThat } from './validate.mjs';

mkdirSync(dirname(config.database), { recursive: true });
export const db = new DatabaseSync(config.database);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

// Ordered, append-only migrations. The applied count is stored in SQLite's user_version.
// Never edit a released migration; add a new one at the end.
const migrations = [
  () => db.exec(`
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS pets(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, species TEXT NOT NULL, details TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY, name TEXT NOT NULL, minutes INTEGER NOT NULL, cents INTEGER NOT NULL, UNIQUE(name, minutes));
  CREATE TABLE IF NOT EXISTS slots(id INTEGER PRIMARY KEY, starts INTEGER NOT NULL, ends INTEGER NOT NULL, CHECK(ends > starts));
  CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), service INTEGER NOT NULL REFERENCES services(id), starts INTEGER NOT NULL, ends INTEGER NOT NULL, cents INTEGER NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Requested', arrived INTEGER, departed INTEGER);
  CREATE TABLE IF NOT EXISTS booking_pets(booking INTEGER NOT NULL REFERENCES bookings(id), pet INTEGER NOT NULL REFERENCES pets(id), PRIMARY KEY(booking,pet));
  CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, booking INTEGER NOT NULL REFERENCES bookings(id), pet INTEGER NOT NULL REFERENCES pets(id), kind TEXT NOT NULL, notes TEXT NOT NULL, published INTEGER NOT NULL, mime TEXT, photo BLOB);
  CREATE INDEX IF NOT EXISTS booking_time ON bookings(starts, ends, status);
  CREATE INDEX IF NOT EXISTS diary_pet ON events(pet,published);
`),
  () => {
    if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'summary')) {
      db.exec("ALTER TABLE bookings ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
    }
  },
  () => db.exec(`
  CREATE INDEX IF NOT EXISTS events_booking ON events(booking);
  CREATE INDEX IF NOT EXISTS bookings_owner ON bookings(owner,starts);
  CREATE INDEX IF NOT EXISTS booking_pets_pet ON booking_pets(pet);
  CREATE INDEX IF NOT EXISTS pets_owner ON pets(owner);
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
  CREATE INDEX IF NOT EXISTS slots_starts ON slots(starts);
`),
];
{
  const applied = db.prepare('PRAGMA user_version').get().user_version;
  requireThat(applied <= migrations.length, 'The database was created by a newer version of myo.', 500);
  for (let index = applied; index < migrations.length; index++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migrations[index]();
      db.exec('PRAGMA user_version = ' + (index + 1));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
// Runs fn inside BEGIN IMMEDIATE. fn must be synchronous: node:sqlite is synchronous and the server is one
// process, so a transaction with no await inside cannot interleave with another request. That is what
// keeps the overlap checks in booking, rescheduling and confirmation race-free.
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    requireThat(!(result instanceof Promise), 'Transactions must be synchronous.', 500);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
