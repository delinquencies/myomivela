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
  // Stored responses for retried writes (lib/idempotency.mjs). status is NULL while the first request runs.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS idempotency(user INTEGER NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER, body TEXT, created INTEGER NOT NULL, PRIMARY KEY(user,key));
  CREATE INDEX IF NOT EXISTS idempotency_created ON idempotency(created);
`),
  // Devices that have signed in to an account before (lib/auth.mjs). They are exempt from account-wide lockouts.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS trusted_devices(token TEXT PRIMARY KEY, user INTEGER NOT NULL, created INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS trusted_devices_user ON trusted_devices(user);
`),
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS checkout_holds(
    owner INTEGER PRIMARY KEY REFERENCES users(id), slot INTEGER NOT NULL,
    service INTEGER NOT NULL, starts INTEGER NOT NULL, ends INTEGER NOT NULL, expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS checkout_holds_expiry ON checkout_holds(expires);
`),
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS schedule_settings(
    id INTEGER PRIMARY KEY CHECK(id=1), days INTEGER NOT NULL, opens INTEGER NOT NULL,
    closes INTEGER NOT NULL, buffer INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedule_exceptions(
    day TEXT PRIMARY KEY, opens INTEGER, closes INTEGER
  );
`),
  // Itemised prices (lib/pricing.mjs): a per-service extra-pet amount and the lines each booking was priced with.
  () => {
    if (!hasColumn('services','extra_pet_cents')) store.exec('ALTER TABLE services ADD COLUMN extra_pet_cents INTEGER NOT NULL DEFAULT 0');
    store.exec(`
  CREATE TABLE IF NOT EXISTS booking_lines(
    booking INTEGER NOT NULL REFERENCES bookings(id), position INTEGER NOT NULL, code TEXT NOT NULL,
    label TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, cents INTEGER NOT NULL, PRIMARY KEY(booking, position)
  );`);
  },
  // Change requests (C1.2): a customer's proposed new time for a confirmed visit, decided by staff.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS booking_changes(
    id INTEGER PRIMARY KEY, booking INTEGER NOT NULL REFERENCES bookings(id), requested_by INTEGER NOT NULL REFERENCES users(id),
    slot INTEGER NOT NULL, starts INTEGER NOT NULL, ends INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Pending','Approved','Declined','Withdrawn')), created INTEGER NOT NULL, decided INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS booking_changes_pending ON booking_changes(booking) WHERE status='Pending';
`),
  // Departure check (C1.3): JSON { secured, note, at } recorded when a visit is completed.
  () => { if (!hasColumn('bookings','departure_check')) store.exec('ALTER TABLE bookings ADD COLUMN departure_check TEXT'); },
  // Service kinds (C1.4): 'visit', 'meet' or 'overnight'. Existing overnight services are marked as such.
  () => {
    if (!hasColumn('services','kind')) store.exec("ALTER TABLE services ADD COLUMN kind TEXT NOT NULL DEFAULT 'visit'");
    store.exec("UPDATE services SET kind='overnight' WHERE name='Overnight pet sitting'");
    store.exec("UPDATE services SET kind='meet' WHERE name='Meet & Greet'");
  },
  // Overnight stays (C2.1): which nights Myomi takes stays, and how late a pickup can be before a surcharge.
  () => {
    if (!hasColumn('schedule_settings','overnight_days')) store.exec('ALTER TABLE schedule_settings ADD COLUMN overnight_days INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('schedule_settings','late_pickup_grace')) store.exec('ALTER TABLE schedule_settings ADD COLUMN late_pickup_grace INTEGER NOT NULL DEFAULT 120');
  },
  // Compliance (C2.2): vaccine records with optional documents, which vaccines each species needs, and versioned
  // service agreements with their acceptances. All start empty, so no gate applies until Myomi sets one up.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS pet_vaccines(
    id INTEGER PRIMARY KEY, pet INTEGER NOT NULL REFERENCES pets(id), name TEXT NOT NULL, given TEXT, expires TEXT NOT NULL,
    document_key TEXT, document_mime TEXT, verified_at INTEGER, verified_by INTEGER, UNIQUE(pet, name)
  );
  CREATE TABLE IF NOT EXISTS vaccine_requirements(species TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(species, name));
  CREATE TABLE IF NOT EXISTS agreements(version INTEGER PRIMARY KEY, title TEXT NOT NULL, body_en TEXT NOT NULL, body_es TEXT NOT NULL, published INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS agreement_acceptances(
    user INTEGER NOT NULL REFERENCES users(id), version INTEGER NOT NULL REFERENCES agreements(version), accepted_at INTEGER NOT NULL,
    PRIMARY KEY(user, version)
  );
`),
  // Home access (C2.3): entry instructions encrypted with the vault key, key custody, and a log of every reveal.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS home_access(
    owner INTEGER PRIMARY KEY REFERENCES users(id), method TEXT NOT NULL, secret_enc TEXT, iv TEXT,
    key_label TEXT, key_status TEXT NOT NULL DEFAULT 'with_client', updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS home_access_log(
    id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, actor INTEGER NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL
  );
`),
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
