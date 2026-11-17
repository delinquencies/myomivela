// The database used by every module. A runtime installs its storage once with useStorage();
// the helpers below then work the same on Node (node:sqlite) and Cloudflare (Durable Object SQLite).
import { requireThat } from './validate.mjs';

let store;
let blobs;

// Ordered, append-only migrations. Each one must be safe to re-run, because databases created before the
// meta table existed start again from 0. Never edit a released migration; add a new one at the end.
const hasColumn = (table, column) => store.all(`PRAGMA table_info(${table})`).some(row => row.name === column);
const migrations = [
  () => store.exec(`
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
  () => { if (!hasColumn('bookings','summary')) store.exec("ALTER TABLE bookings ADD COLUMN summary TEXT NOT NULL DEFAULT ''"); },
  () => store.exec(`
  CREATE INDEX IF NOT EXISTS events_booking ON events(booking);
  CREATE INDEX IF NOT EXISTS bookings_owner ON bookings(owner,starts);
  CREATE INDEX IF NOT EXISTS booking_pets_pet ON booking_pets(pet);
  CREATE INDEX IF NOT EXISTS pets_owner ON pets(owner);
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
  CREATE INDEX IF NOT EXISTS slots_starts ON slots(starts);
`),
  // Photos move out of the database into blob storage (files locally, R2 on Cloudflare), keyed by photo_key.
  // The old `photo` BLOB column is no longer read; it only ever held test data.
  () => { if (!hasColumn('events','photo_key')) store.exec('ALTER TABLE events ADD COLUMN photo_key TEXT'); },
];
export const schemaVersion = migrations.length;

function migrate() {
  // PRAGMA user_version is not available on Durable Objects, so the version lives in a meta table.
  store.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const applied = Number(store.get("SELECT value FROM meta WHERE key='schema_version'")?.value || 0);
  requireThat(applied <= migrations.length, 'The database was created by a newer version of myo.', 500);
  for (let index = applied; index < migrations.length; index++) {
    store.transaction(() => {
      migrations[index]();
      store.run("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(index + 1));
    });
  }
}

export function useStorage(sqlStore, blobStore) {
  store = sqlStore;
  blobs = blobStore;
  migrate();
}

export const get = (sql, ...args) => store.get(sql, ...args);
export const all = (sql, ...args) => store.all(sql, ...args);
export const run = (sql, ...args) => store.run(sql, ...args);
// Runs fn all-or-nothing. fn must be synchronous: both SQLite APIs are synchronous and requests are handled by a
// single process (Node) or a single Durable Object, so a transaction with no await inside cannot interleave with
// another request. That is what keeps the overlap checks in booking, rescheduling and confirmation race-free.
export function transaction(fn) {
  return store.transaction(() => {
    const result = fn();
    requireThat(!(result instanceof Promise), 'Transactions must be synchronous.', 500);
    return result;
  });
}
export const photos = {
  put: (key, bytes, mime) => blobs.put(key, bytes, mime),
  get: key => blobs.get(key),
  delete: key => blobs.delete(key),
};
