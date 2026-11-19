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
  // Report cards (C2.4): an update's structured answers, stored with their labels as published.
  () => { if (!hasColumn('events','data')) store.exec('ALTER TABLE events ADD COLUMN data TEXT'); },
  // Care record (C2.5): pet profile versions, the version each booking was confirmed with, and private visit feedback.
  () => {
    store.exec(`
  CREATE TABLE IF NOT EXISTS pet_profile_versions(
    id INTEGER PRIMARY KEY, pet INTEGER NOT NULL REFERENCES pets(id), name TEXT NOT NULL, species TEXT NOT NULL, details TEXT NOT NULL, created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pet_profile_versions_pet ON pet_profile_versions(pet, id);
  CREATE TABLE IF NOT EXISTS visit_feedback(
    booking INTEGER PRIMARY KEY REFERENCES bookings(id), score INTEGER NOT NULL CHECK(score IN (-1,0,1)),
    comment TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL
  );`);
    if (!hasColumn('booking_pets','profile_version')) store.exec('ALTER TABLE booking_pets ADD COLUMN profile_version INTEGER');
  },
  // Language (C2.6): each account's language, for messages sent outside the portal later.
  () => { if (!hasColumn('users','locale')) store.exec("ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'"); },
  // Staff notes (C2.7): private notes about a customer or a pet. Never sent to customers.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS staff_notes(
    id INTEGER PRIMARY KEY, subject_type TEXT NOT NULL CHECK(subject_type IN ('client','pet')), subject_id INTEGER NOT NULL,
    body TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS staff_notes_subject ON staff_notes(subject_type, subject_id);
`),
  // Fee rules (C3.4): surcharges added to a quote in a fixed order, and the holidays a holiday rule applies on.
  // Both start empty, so prices are unchanged until Myomi adds a rule.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS fee_rules(
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('weekend','holiday','after_hours','short_notice')),
    amount_type TEXT NOT NULL CHECK(amount_type IN ('flat','percent')), value INTEGER NOT NULL,
    params TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS holidays(day TEXT PRIMARY KEY, name TEXT NOT NULL);
`),
  // Money (C3.1): every payment, refund and credit is a ledger line (a card refund names its payment in payment_ref), and a booking's balance is derived from them.
  // Hosted checkout sessions are tracked until the provider's signed webhook settles them; webhook events are
  // recorded by id so a replay changes nothing. cancel_fee_cents is what a cancelled booking still owes (C3.2).
  () => {
    store.exec(`
    CREATE TABLE IF NOT EXISTS ledger_entries(
      id INTEGER PRIMARY KEY, booking INTEGER REFERENCES bookings(id), owner INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('payment','refund','credit')), cents INTEGER NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('card','cash','check','other','package')), provider_ref TEXT,
      payment_ref TEXT, created INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', recorded_by INTEGER REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ledger_provider_ref ON ledger_entries(kind, provider_ref) WHERE provider_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ledger_booking ON ledger_entries(booking);
    CREATE TABLE IF NOT EXISTS checkout_sessions(
      id INTEGER PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE, owner INTEGER NOT NULL REFERENCES users(id),
      booking INTEGER REFERENCES bookings(id), package INTEGER, amount INTEGER NOT NULL, url TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','paid','expired','failed')), expires INTEGER NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY, type TEXT NOT NULL, received INTEGER NOT NULL);
  `);
    if (!hasColumn('users','auto_tip_percent')) store.exec('ALTER TABLE users ADD COLUMN auto_tip_percent INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('bookings','cancel_fee_cents')) store.exec('ALTER TABLE bookings ADD COLUMN cancel_fee_cents INTEGER NOT NULL DEFAULT 0');
  },
  // Cancellation policy (C3.2), per service: how many hours before the start a customer can cancel for free, and
  // the fee after that as a percentage. The fee starts at 0, so nothing is charged until Myomi sets one.
  () => {
    if (!hasColumn('services','cancel_cutoff_hours')) store.exec('ALTER TABLE services ADD COLUMN cancel_cutoff_hours INTEGER NOT NULL DEFAULT 24');
    if (!hasColumn('services','cancel_fee_percent')) store.exec('ALTER TABLE services ADD COLUMN cancel_fee_percent INTEGER NOT NULL DEFAULT 0');
  },
  // Recurring visits (C3.3): a customer's weekly pattern, the dates they skipped, and which booking each pattern
  // date became. A date is generated once; cancelling that booking does not bring it back (un-skipping does).
  () => {
    store.exec(`
    CREATE TABLE IF NOT EXISTS recurring_series(
      id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), service INTEGER NOT NULL REFERENCES services(id),
      pets TEXT NOT NULL, weekdays INTEGER NOT NULL, start_minute INTEGER NOT NULL, from_day TEXT NOT NULL, until_day TEXT,
      notes TEXT NOT NULL DEFAULT '', auto_approve INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
      ended INTEGER, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS series_skips(series INTEGER NOT NULL REFERENCES recurring_series(id), day TEXT NOT NULL, PRIMARY KEY(series, day));
  `);
    if (!hasColumn('bookings','series')) store.exec('ALTER TABLE bookings ADD COLUMN series INTEGER REFERENCES recurring_series(id)');
    if (!hasColumn('bookings','series_day')) store.exec('ALTER TABLE bookings ADD COLUMN series_day TEXT');
    store.exec('CREATE UNIQUE INDEX IF NOT EXISTS bookings_series_day ON bookings(series, series_day) WHERE series_day IS NOT NULL');
  },
  // Packages (C3.5): prepaid visit credits for one service. A balance is what a customer bought; a booking that
  // uses one names it, and the credit becomes a ledger line when the booking is confirmed.
  () => {
    store.exec(`
    CREATE TABLE IF NOT EXISTS packages(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, service INTEGER NOT NULL REFERENCES services(id), credits INTEGER NOT NULL,
      cents INTEGER NOT NULL, expires_days INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS package_balances(
      id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), package INTEGER NOT NULL REFERENCES packages(id),
      credits INTEGER NOT NULL, remaining INTEGER NOT NULL, expires INTEGER NOT NULL, purchased INTEGER NOT NULL,
      cents INTEGER NOT NULL, method TEXT NOT NULL, provider_ref TEXT UNIQUE
    );
  `);
    if (!hasColumn('bookings','package_balance')) store.exec('ALTER TABLE bookings ADD COLUMN package_balance INTEGER REFERENCES package_balances(id)');
  },
  // Notification outbox (C3.6): messages written in the same transaction as the change they report, sent later by
  // the configured driver. dedupe_key makes a message happen once however often its trigger runs.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS outbox(
    id INTEGER PRIMARY KEY, user INTEGER NOT NULL REFERENCES users(id), template TEXT NOT NULL, params TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0,
    send_after INTEGER NOT NULL, sent_at INTEGER, last_error TEXT, dedupe_key TEXT NOT NULL UNIQUE, created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, send_after);
`),
  // Staff roles: 'owner' (everything) or 'sitter' (runs visits; no prices, settings, money or accounts), and
  // switching a staff account off without deleting the visits and notes it is linked to. Existing staff are owners.
  () => {
    if (!hasColumn('users','role')) store.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'");
    if (!hasColumn('users','disabled')) store.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
  },
  () => {
    store.exec(`
  CREATE TABLE IF NOT EXISTS care_intakes(
    owner INTEGER PRIMARY KEY REFERENCES users(id), body TEXT NOT NULL, updated INTEGER NOT NULL
  );
  `);
    if (!hasColumn('bookings','meet_booking')) store.exec('ALTER TABLE bookings ADD COLUMN meet_booking INTEGER REFERENCES bookings(id)');
    if (!hasColumn('bookings','primary_pet')) store.exec('ALTER TABLE bookings ADD COLUMN primary_pet INTEGER REFERENCES pets(id)');
    if (!hasColumn('booking_changes','proposed_cents')) store.exec('ALTER TABLE booking_changes ADD COLUMN proposed_cents INTEGER');
    store.exec("CREATE UNIQUE INDEX IF NOT EXISTS booking_meet_unique ON bookings(meet_booking) WHERE meet_booking IS NOT NULL AND status<>'Cancelled'");
  },
  // Contact (CUX-08): the client's phone and the home where care happens, with its ZIP for the service-area check.
  () => {
    for (const column of ['phone','address','zip']) if (!hasColumn('users',column)) store.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
  },
  // Request timeline (CUX-05): when a booking was requested, confirmed and cancelled. Null for bookings made earlier.
  () => {
    for (const column of ['created','confirmed_at','cancelled_at']) if (!hasColumn('bookings',column)) store.exec(`ALTER TABLE bookings ADD COLUMN ${column} INTEGER`);
  },
  // Password recovery (CUX-07): single-use reset tokens, stored only as hashes. Short-lived, so not in backups.
  () => store.exec(`
  CREATE TABLE IF NOT EXISTS password_resets(
    token_hash TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user);
`),
  // Owner decisions of Nov 19, 2026 (CUX-02/04): one Meet & Greet now covers every booking of a client, so a meeting
  // may be linked to many bookings (existing links are kept); a paid request records its 50% deposit and the time it is
  // due (48 hours after the request), why a booking was cancelled, and which terms the client accepted.
  () => {
    store.exec('DROP INDEX IF EXISTS booking_meet_unique');
    const columns = { deposit_cents:'INTEGER NOT NULL DEFAULT 0', deposit_due_at:'INTEGER', cancel_reason:'TEXT', terms_version:'TEXT', terms_accepted_at:'INTEGER' };
    for (const [column, type] of Object.entries(columns)) if (!hasColumn('bookings',column)) store.exec(`ALTER TABLE bookings ADD COLUMN ${column} ${type}`);
  },
  // Step-up check (audit F5): when this session last proved its password. Sessions are not in backups.
  () => { if (!hasColumn('sessions','verified')) store.exec('ALTER TABLE sessions ADD COLUMN verified INTEGER'); },
];
export const schemaVersion = migrations.length;

function migrate() {
  // PRAGMA user_version is not available on Durable Objects, so the version lives in a meta table.
  store.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let applied = Number(store.get("SELECT value FROM meta WHERE key='schema_version'")?.value || 0);
  // The unpublished local launch iteration used slot 20 before main's Phase 3 migrations arrived.
  // Detect that exact fork and replay main's idempotent migrations before the appended intake migration.
  if(applied===20 && store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='care_intakes'") &&
      !store.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fee_rules'")){
    applied=19;
    store.run("UPDATE meta SET value='19' WHERE key='schema_version'");
  }
  requireThat(applied <= migrations.length, 'The database was created by a newer version of myo.', 500);
  for (let index = applied; index < migrations.length; index++) {
    store.transaction(() => {
      migrations[index]();
      store.run("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(index + 1));
    });
  }
}

// `backupStore` (optional) is where scheduled backups go: see lib/scheduled-backup.mjs.
let backupTarget = null;
export const backupStore = () => backupTarget;
export function useStorage(sqlStore, blobStore, backupStoreAdapter = null) {
  store = sqlStore;
  blobs = blobStore;
  backupTarget = backupStoreAdapter;
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
