# Claude Code track

November 18, 2026 · Based on [the competitive audit](../competitive-audit.md) · Pairs with [the Codex track](codex-plan.md)

This track owns the work that crosses layers: schema evolution, state machines, access rules, encryption, money, and the API contracts the Codex tickets build on.
- **Done** for each task means: migration, routes, tests on both runtimes, and the published contract.
- **Codex tickets** then implement the UI, copy and end-to-end journeys against that contract.

## Invariants every task must keep
- **Migrations:** append-only and safe to re-run (`lib/db.mjs`). Add new tables that hold durable data to `backupTables` in `lib/backup.mjs` (session-like tables are cleared on restore instead).
- **Transactions:** keep `transaction()` callbacks synchronous. Do any `await` (R2, crypto, password hashing) first, then re-check state inside the transaction (`POST /api/events` is the model).
- **Access rules:** every route declares `access`, so `tests/routes.test.mjs` checks it automatically. Customer data is owner-scoped through `bookingFor()` and `bookingRows()` in `lib/bookings.mjs`, or an equivalent owner check.
- **Retries:** writes are idempotency-safe. Mark routes whose request bodies contain secrets or passwords `idempotent:false`, so nothing derived from them is stored in `idempotency`.
- **Runtimes:** every server test runs under `npm test` and `npm run test:worker`. Node-only cases use `{ skip:nodeOnly }`.
- **Money:** all amounts are integer cents. Times are epoch milliseconds; anything shown to people is in `America/New_York`.
- **Error shape** (introduced in C1.1; the default for everything after it): `{ error:string, code?:string, ...details }`. `errorResponse()` in `lib/headers.mjs` gains optional `code` and `details` fields, read from `Object.assign(new Error(msg), { status, code, details })`.

## Dependency overview
```
Phase 1  C1.1 Quote lines + error codes ─┬─▶ Codex X1.6
         C1.2 Change requests ───────────┼─▶ Codex X1.7
         C1.3 Departure check ───────────┼─▶ Codex X1.8
         C1.4 Service kinds + meet ──────┴─▶ Codex X1.9
Phase 2  C2.1 Overnight stays (needs C1.1, C1.4) ──▶ X2.8
         C2.2 Compliance gates (needs C1.1 errors, C1.4) ──▶ X2.1, X2.2
         C2.3 Home-access vault ──▶ X2.3
         C2.4 Report cards ──▶ X2.4
         C2.5 Care record: profile versions, timeline, feedback ──▶ X2.5, X2.7
         C2.6 i18n plumbing (needs C1.1 error codes) ──▶ X2.6
         C2.7 Staff client records ──▶ X2.9
Phase 3  C3.1 Ledger + payments (provider decision) ──▶ X3.1
         C3.2 Cancellation policy (needs C3.1) ──▶ X3.2
         C3.3 Recurring series (needs C1.2, C1.1) ──▶ X3.3
         C3.4 Fee rules (needs C1.1) ──▶ X3.4
         C3.5 Packages (needs C3.1) ──▶ X3.5
         C3.6 Notification outbox (provider decision) ──▶ X3.6
```

---

## Phase 1

### C1.1: Itemised quotes and machine-readable errors · Phase 1
**Status: done** (migration 9, `lib/pricing.mjs`, `tests/pricing.test.mjs`, browser scenario 6 in `tests/browser/holds-smoke.mjs`). The portal sends the same total, computed by `bookingTotal()`, and shows the server's total on review; the itemised display is Codex X1.6.

**Why Claude:** this changes the pricing contract shared by `/api/checkout-hold`, `/api/bookings`, `/api/portal`, financials, backup and every later pricing feature (extra pets, late pickup, fee rules, ledger). It also changes the error shape every client consumes.

**Design**
- **Migration 9:**
  - `ALTER TABLE services ADD COLUMN extra_pet_cents INTEGER NOT NULL DEFAULT 0`
  - `CREATE TABLE booking_lines(booking INTEGER NOT NULL REFERENCES bookings(id), position INTEGER NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, cents INTEGER NOT NULL, PRIMARY KEY(booking, position))`
  - Add `booking_lines` to `backupTables`.
- **New `lib/pricing.mjs`:** `quote({ service, petCount, starts, ends }) → { lines, total_cents }`.
  - Phase 1 produces two kinds of line: `base` (`service.cents`) and `extra_pet` (`(petCount-1) × extra_pet_cents`, emitted only when non-zero).
  - Later tasks add `nightly` and `late_pickup` (C2.1) and the C3.4 fee codes.
- **`bookingSelection()`** in `lib/routes/bookings.mjs` computes the quote and compares `data.cents` with `total_cents`. A mismatch is 409 with `code:'price_changed'`.
  - `POST /api/bookings` inserts the `booking_lines` rows and sets `bookings.cents = total_cents`.
  - `/api/financials` is unchanged, because it sums `bookings.cents`.
- **New route:** `POST /api/quote` (access `user`, customers only).
- **`POST /api/services`** accepts `extra_pet_cents` (integer 0–100000, default 0).
- **`bookingRows()`** returns `lines`. When a booking has no `booking_lines` rows (created before migration 9), it synthesises `[{ code:'base', label:service_name, quantity:1, cents:bookings.cents }]`.
- **Error codes:** `errorResponse()` includes `code` and `details`. Existing messages stay the same; add codes at the call sites in `reserveTime()`: `time_unavailable`, `window_too_short`, `time_reserved`. Add `hold_expired` in `POST /api/bookings`.

**Edge cases and failure modes**
- **Price changed between quote and send:** reject with 409 `price_changed`. The client re-quotes; `reopenBooking()` already handles a 409.
- **Rescheduling keeps the original lines and price.** Only C3.4 fee rules could change that, and only through a change request.
- **Duplicate pet IDs** are already de-duplicated by the `Set`.
- **Restoring an older backup without `booking_lines`:** `restoreTables()` treats missing tables as empty when `schema_version` is lower. Today it refuses any version mismatch; keep the refusal and document it.

**Handoff contract for Codex**
```js
// POST /api/quote  (customer)
// request
{ service:number, pets:number[], slot:number, start:number }
// 200
{ starts:number, ends:number, total_cents:number,
  lines:[{ code:'base'|'extra_pet', label:string, quantity:number, cents:number }] }
// 409
{ error:string, code:'time_unavailable'|'window_too_short'|'time_reserved' }

// POST /api/checkout-hold: 200 response gains the same `lines` and `total_cents`
// POST /api/bookings: `cents` must equal total_cents, else 409 { code:'price_changed' }
// GET /api/portal: each booking gains `lines` (same shape)
// GET /api/catalog and /api/portal services: each service gains `extra_pet_cents:number`
// Every error body: { error:string, code?:string }
```

### C1.2: Change requests for confirmed visits · Phase 1
**Status: done** (migration 10, `tests/changes.test.mjs`, browser scenario 7). The contract also includes `last_change: { id, status:'Approved'|'Declined', starts, ends, decided } | null` for showing a decision once. Minimal UI shipped so neither side is stranded: the requested-change note and **Withdraw request** for customers, **Approve change** and **Decline change** for staff, and pending changes counted on the staff home card. Codex X1.7 refines it.

**Why Claude:** a new state machine. The booking keeps its confirmed time while a proposed change waits. It touches conflict checks, the early-start rule, cancellation and staff approval.

**Design**
- **Migration 10:** `CREATE TABLE booking_changes(id INTEGER PRIMARY KEY, booking INTEGER NOT NULL REFERENCES bookings(id), requested_by INTEGER NOT NULL REFERENCES users(id), slot INTEGER NOT NULL, starts INTEGER NOT NULL, ends INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('Pending','Approved','Declined','Withdrawn')), created INTEGER NOT NULL, decided INTEGER)`. Add a unique partial index allowing one Pending change per booking: `CREATE UNIQUE INDEX booking_changes_pending ON booking_changes(booking) WHERE status='Pending'`. Add the table to `backupTables`.
- **`POST /api/reschedule`:**
  - A customer on a **Requested** booking: moves it directly, as today.
  - A customer on a **Confirmed** booking: validates the new time with `reserveTime()` (excluding this booking), then inserts a Pending change. The booking stays Confirmed at its original time.
  - Staff: unchanged.
- **New routes:**
  - `POST /api/changes/decide` (staff) `{ id, decision:'approve'|'decline' }`. Approve re-checks `reserveTime()` and `windowCovers()` inside the transaction, moves the booking and keeps it Confirmed.
  - `POST /api/changes/withdraw` (customer, owner only) `{ id }`.
- **Cancelling** a booking (`POST /api/status` with Cancelled) withdraws its Pending change in the same transaction.
- **`bookingRows()`** returns `pending_change: { id, starts, ends } | null`.

**Edge cases and failure modes**
- **The proposed time is taken before approval:** approve returns 409 `time_reserved`, and the change stays Pending so staff can decline it.
- **The original time passes while a change is Pending:** the early-start rule and Start apply to the original time. Starting the visit auto-declines the change.
- **The proposed time is in the past at approval:** 409 `time_unavailable`.
- **Pending changes don't reserve time.** That's consistent with how Requested bookings work today, and documented.

**Handoff contract for Codex**
```js
// POST /api/reschedule  (customer, Confirmed booking)
// request (unchanged): { id:number, slot:number, start:number }
// 200: { change:{ id:number, starts:number, ends:number, status:'Pending' } }
// POST /api/reschedule  (customer, Requested booking): 200 {}   (moved directly, as today)
// POST /api/changes/decide   (staff)    { id:number, decision:'approve'|'decline' } → 200 {}
//   409 { code:'time_reserved'|'time_unavailable' }
// POST /api/changes/withdraw (customer) { id:number } → 200 {}
// GET /api/portal bookings[i].pending_change: { id, starts, ends } | null
```

### C1.3: Departure check (door locked) · Phase 1
**Status: done** (migration 11, `tests/departure.test.mjs`, completion paths in `tests/browser/portal-smoke.mjs`). Minimal UI shipped, because the server now requires the check: a checkbox and note on the completion form, with **Complete visit** gated, and one line in the customer's diary. Codex X1.8 refines copy and layout.

**Why Claude:** a schema change plus server validation, a completion-rule change in the state machine, and new diary payload fields that the customer renderer depends on.

**Design**
- **Migration 11:** `ALTER TABLE bookings ADD COLUMN departure_check TEXT`, holding JSON `{ secured:boolean, note:string, at:number }`.
- **`POST /api/status` with Completed:**
  - Requires `secured` (`true` or `false`).
  - When `secured === false`, `secure_note` is required: 3–500 characters after trimming.
  - The check and the `summary` are stored in the same `UPDATE`.
  - A missing `secured` is 400 with `code:'departure_check_required'`. A missing note is 400 with `code:'secure_note_required'`.
- **`bookingRows()`** returns `departure_check` parsed, or `null` for older visits. It's visible to both roles.

**Edge cases and failure modes**
- **Visits completed before migration 11** show no check. Don't backfill.
- **Clients that send only `summary`:** the existing browser tests complete visits that way. Update `tests/browser/*.mjs`, `tests/api.test.mjs`, `tests/image.test.mjs`, `tests/backup.test.mjs`, `tests/idempotency.test.mjs` and `tests/pagination.test.mjs` in the same change.

**Handoff contract for Codex**
```js
// POST /api/status { id, status:'Completed', summary:string, secured:boolean, secure_note?:string }
// 400 { code:'departure_check_required'|'secure_note_required' }
// bookings[i].departure_check and diary visits[i].departure_check:
//   { secured:boolean, note:string, at:number } | null
// Form field names the UI must use: secured (checkbox, value "1" → true), secure_note (textarea)
```

### C1.4: Service kinds and a free meet & greet · Phase 1
**Status: done** (migration 12, `tests/service-kinds.test.mjs`). Staff can set the Meet & Greet price in Settings (🤝). The customer-facing "Free" labels, the first-visit card and the homepage link are Codex X1.9.

**Why Claude:** introduces `services.kind`, which overnight stays (C2.1), the compliance gates (C2.2) and the report cards (C2.4) all branch on. It also changes catalog validation and what "first visit" means.

**Design**
- **Migration 12:** `ALTER TABLE services ADD COLUMN kind TEXT NOT NULL DEFAULT 'visit'`.
  - Allowed values: `'visit'|'meet'|'overnight'`, enforced in code because SQLite `ALTER` can't add a `CHECK`.
  - Back-fill `kind='overnight'` where `name='Overnight pet sitting'`.
- **`lib/domain.mjs`:** `serviceNames` becomes `serviceCatalog = [{ name:'Dog walking', kind:'visit' }, { name:'Drop-in visit', kind:'visit' }, { name:'Overnight pet sitting', kind:'overnight' }, { name:'Meet & Greet', kind:'meet' }]`.
- **`POST /api/services`:** derives `kind` from the name. `meet` must have `cents === 0` and `extra_pet_cents === 0`.
- **`GET /api/portal`** for customers adds `first_visit:boolean`: true when the customer has no Completed booking of any kind.
- **Diary:** a meet booking moves through the same statuses; `POST /api/events` is allowed. Nothing else changes.

**Edge cases and failure modes**
- **Bookings made before the kind existed** keep working: the default is `visit`.
- **Overnight booked through the grid:** stays possible until C2.1 lands (the current behaviour).
- **Meet & greets are $0,** which the future ledger (C3.1) must skip, and `/api/financials` excludes naturally.

**Handoff contract for Codex**
```js
// services[i].kind: 'visit'|'meet'|'overnight'   (in /api/catalog, /api/availability, /api/portal)
// GET /api/portal (customer) → first_visit:boolean
// A meet & greet books through the existing quote, hold and booking endpoints; total_cents is 0
```

---

## Phase 2

### C2.1: Overnight stays as residencies · Phase 2 · needs C1.1, C1.4
**Status: done** (migration 13, `tests/overnight.test.mjs`, browser scenario 8 in `holds-smoke.mjs`). Deviations from the design below: no `planned_departure` column, because `bookings.ends` is the planned pickup and `departed` the actual one. The stay-conflict rule is a shared `clashes()` used by every availability check. Stay reschedules are refused for now.

**Why Claude:** a new availability model alongside `schedule_settings` and `upcomingWindows()`, multi-day conflict logic in `reserveTime()` and `conflict()`, nightly pricing and late-pickup lines in `lib/pricing.mjs`, and diary grouping by night. This is the core of our overnight wedge.

**Design**
- **Migration:**
  - `ALTER TABLE schedule_settings ADD COLUMN overnight_days INTEGER NOT NULL DEFAULT 0` (bitmask of the nights that can start on each weekday)
  - `ALTER TABLE schedule_settings ADD COLUMN late_pickup_grace INTEGER NOT NULL DEFAULT 120` (minutes)
  - `ALTER TABLE bookings ADD COLUMN planned_departure INTEGER`
- **Overnight pricing:** `services.cents` is the price per night, and `minutes` is ignored.
- **Requests** for overnight services use `{ service, pets, arrive:number, depart:number }` instead of `slot` and `start`.
  - Rules: arrival and departure on the 30-minute grid; `nights = number of Eastern calendar dates crossed`, at least 1; every night allowed by `overnight_days`, with no closing exception.
  - Stays can't overlap another Confirmed or In Progress overnight.
  - Daytime visits during a stay are allowed, except within the buffer of arrival and departure.
- **`quote()`** emits a `nightly` line (quantity = nights) and an `extra_pet` line per night.
- **At completion,** if `departed > planned_departure + late_pickup_grace`, add a `late_pickup` line: +50% of one night up to 8 hours late, +100% beyond. Record it in `booking_lines` and adjust `bookings.cents`.
- **Diary:** `GET /api/diary` adds `nights:[{ date:'YYYY-MM-DD', event_ids:number[] }]` for overnight visits, grouped by Eastern date with arrival-day events in night 1.
- **Event kinds:** `activityTypes` gains `Arrival`, `Evening check-in`, `Morning check-in`, `Departure`.

**Edge cases and failure modes**
- **Daylight-saving nights** (23 or 25 hours) still count as one night.
- **A closed date in the middle of a stay** blocks the whole stay.
- **Cancelling partway through** is out of scope until C3.2; staff must complete or cancel the stay.
- **Holds** cover the whole stay range.
- **The early-start rule** applies to `starts`, which is the arrival.

**Handoff contract for Codex**
```js
// POST /api/quote | /api/checkout-hold | /api/bookings for kind 'overnight':
//   { service, pets:number[], arrive:number, depart:number, cents?:number, hold?:number, notes? }
//   → quote lines include { code:'nightly', quantity:nights, cents } and maybe 'extra_pet'
// GET /api/portal schedule (staff): overnight_days:number (bitmask), late_pickup_grace:number
// POST /api/schedule accepts overnight_days:number[] (0–6) and late_pickup_grace:number
// GET /api/portal (customer) → overnight_nights:[{ date:'YYYY-MM-DD' }]  next 60 bookable nights
// diary visits[i].nights?: [{ date:string, event_ids:number[] }]
// activityTypes adds 'Arrival', 'Evening check-in', 'Morning check-in', 'Departure'
```

### C2.2: Compliance gates (vaccines, agreement, meet first) · Phase 2 · needs C1.1, C1.4
**Status: done** (migration 14, `lib/compliance.mjs`, `lib/routes/compliance.mjs`, `tests/compliance.test.mjs`). Deviation: requirements are **not** seeded with defaults, and the agreement and meet gates apply only once set up, so turning any gate on is Myomi's decision. Staff set requirements with `POST /api/vaccine-requirements` and publish agreements with `POST /api/agreements`. The restore route accepts `vaccines/` keys, so the planned `/api/restore/blob` rename wasn't needed.

**Why Claude:** new tables, document upload to R2, staff verification, and one gate function shared by quotes, holds, bookings and the UI. Blocked requests return structured errors.

**Design**
- **New tables:**
  - `pet_vaccines(id INTEGER PRIMARY KEY, pet INTEGER NOT NULL REFERENCES pets(id), name TEXT NOT NULL, given TEXT, expires TEXT NOT NULL, document_key TEXT, verified_at INTEGER, verified_by INTEGER, UNIQUE(pet, name))`
  - `vaccine_requirements(species TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(species, name))`, defaulting to `dog: Rabies, DHPP, Bordetella` and `cat: Rabies, FVRCP`
  - `agreements(version INTEGER PRIMARY KEY, title TEXT NOT NULL, body_en TEXT NOT NULL, body_es TEXT NOT NULL, published INTEGER NOT NULL)`
  - `agreement_acceptances(user INTEGER NOT NULL REFERENCES users(id), version INTEGER NOT NULL, accepted_at INTEGER NOT NULL, PRIMARY KEY(user, version))`
  - All four go in `backupTables`. Vaccine documents go to R2 under `vaccines/<uuid>` and are included in the backup stream like photos.
- **New `lib/compliance.mjs`:** `blockers(user, { service, petIds, starts, ends }) → Blocker[]`. It's called inside `POST /api/checkout-hold` and `POST /api/bookings`, which return 409 `{ code:'blocked', blockers }`, and exposed through `GET /api/blockers`.
- **Gate rules:**
  - Vaccines apply to kinds `visit` and `overnight`, not `meet`. A required vaccine must exist and expire on or after the last day of the booking.
  - The agreement must have been accepted at its latest version.
  - `meet_required` applies only to `overnight` when `first_visit` is true.
  - Species matching is case-insensitive, with `species` normalised to `dog`/`cat`/other. Other species have no requirements by default.
- **Badges:** status is `ok` when the expiry is more than 30 days away, `due_soon` within 30 days, `expired` after it, and `missing` when absent. That gives the red and orange states.

**Edge cases and failure modes**
- **Customers enter their own dates.** Gating uses `expires` whether or not it has been verified, and staff verification is informational. Making verification mandatory is an owner decision; build it as a flag.
- **Document uploads:** PDF, JPEG, PNG or WebP of 5 MB or less. Images are stripped of metadata with `stripMetadata()`. PDFs are stored as uploaded and served only to the owner and staff, with `Content-Disposition: attachment`.
- **The agreement changes between quote and send:** the send returns `blocked` with `agreement_required`.
- **Restore:** documents go through the same flow as photos (`/api/restore/photo` is generalised to `/api/restore/blob`).

**Handoff contract for Codex**
```js
// Blocker = { code:'vaccine_missing'|'vaccine_expired'|'vaccine_expires_during'|'agreement_required'|'meet_required',
//             pet_id?:number, vaccine?:string, expires?:string /*YYYY-MM-DD*/, message:string }
// GET  /api/blockers?service=1&pets=2,3&starts=..&ends=..   (customer) → { blockers:Blocker[] }
// 409 from /api/checkout-hold and /api/bookings: { error:string, code:'blocked', blockers:Blocker[] }
// GET  /api/portal pets[i].vaccines: [{ id, name, given:string|null, expires:string, verified:boolean,
//        status:'ok'|'due_soon'|'expired'|'missing', has_document:boolean }]
//      plus requirements:{ [species:string]: string[] }
// POST /api/vaccines          (customer) { pet, name, given?, expires } → { id }
// POST /api/vaccines/document (customer) { id, document:'data:<mime>;base64,..' } → {}
// GET  /api/vaccines/:id/document  (owner or staff) → file
// POST /api/vaccines/verify   (staff) { id } → {}
// GET  /api/agreement  (user) → { version, title, body_en, body_es, accepted:boolean }
// POST /api/agreement/accept (customer) { version } → {}
```

### C2.3: Home-access vault and key custody · Phase 2
**Status: done** (migration 15, `lib/vault.mjs`, `lib/routes/access.mjs`, `tests/home-access.test.mjs`). Deviation: rotation uses `MYO_VAULT_KEY_PREVIOUS`, with lazy re-encryption on read, instead of a script, so it works on both runtimes. Ciphertext is bound to its owner (AES-GCM additional data). No UI yet: Codex X2.3.

**Why Claude:** encryption at rest that works the same on both runtimes, a time-boxed reveal rule tied to booking state, an audit log, backup handling of ciphertext, and keeping secrets out of the idempotency store.

**Design**
- **New tables:**
  - `home_access(owner INTEGER PRIMARY KEY REFERENCES users(id), method TEXT NOT NULL, secret_enc TEXT, iv TEXT, key_label TEXT, key_status TEXT NOT NULL DEFAULT 'with_client', updated INTEGER NOT NULL)`
  - `home_access_log(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, actor INTEGER NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL)`
  - Allowed values, checked in code: `method ∈ key|lockbox|code|doorman|other`, `key_status ∈ with_client|with_myomi|returned`.
- **Encryption:**
  - New `lib/vault.mjs`, using WebCrypto AES-GCM-256 (`crypto.subtle` exists on Node 22 and Workers).
  - The key comes from `MYO_VAULT_KEY`: 32 bytes, base64, read in `lib/config.mjs`.
  - `productionProblems()` refuses to start without it on Node. The Worker refuses vault routes with 503 `code:'vault_unconfigured'`.
- **Reveal rule:** staff can read the secret only for a booking of that owner that is In Progress, or Confirmed and inside `earlyStartMinutes()` of its start. Each read appends `home_access_log(action:'view')`.
- **Routes:** customer and staff routes as in the contract below. The routes that carry secrets are `idempotent:false`.
- **Key prompt:** `GET /api/portal` for staff adds `keys_to_return:[{ owner, customer, key_label }]` when `key_status='with_myomi'` and the owner has no upcoming Confirmed booking. That's the "keys no longer needed" prompt.

**Edge cases and failure modes**
- **Key rotation:** document a manual re-encrypt script (`scripts/rotate-vault-key.mjs`, part of this task).
- **Backups** export `secret_enc` and `iv` only, so restoring requires the same `MYO_VAULT_KEY`. A mismatch is surfaced by `GET /api/home-access/:booking` returning 500 `code:'vault_decrypt_failed'` rather than garbage.
- **Logging:** never log the plaintext. Ensure `console.error` paths don't include request bodies for these routes.
- **The secret is hidden** from `bookingRows()` and from the diary.

**Handoff contract for Codex**
```js
// GET  /api/home-access (customer) → { method, instructions:string, key_label:string|null, key_status, updated } | null
// POST /api/home-access (customer) { method, instructions:string(≤1000), key_label?:string(≤40) } → {}
// GET  /api/home-access/booking/:id (staff) → { method, instructions, key_label, key_status }
//      403 { code:'access_not_yet', available_from:number }
// POST /api/keys (staff) { owner:number, key_status:'with_client'|'with_myomi'|'returned' } → {}
// GET /api/portal (staff): bookings[i].home_access:{ method, key_status } | null ;  keys_to_return:[{ owner, customer, key_label }]
```

### C2.4: Structured report cards with conditional hiding · Phase 2 · needs C1.4
**Status: done** (migration 16, `tests/report-cards.test.mjs`, chips checked in `portal-smoke.mjs`). Answers are stored as `[{ id, label, type, value, hideWhen? }]`, so later template edits don't change history. The renderer reads `event.fields` directly rather than taking a `fieldsFor` argument.

**Why Claude:** a JSON schema on `events`, per-kind templates, validation in `POST /api/events`, filtering by role in `GET /api/diary`, backup compatibility, and a renderer contract.

**Design**
- **Migration:** `ALTER TABLE events ADD COLUMN data TEXT`, holding JSON `{ [fieldId]: boolean|number|string }`.
- **`lib/domain.mjs` `reportFields`:**
  - Keyed by service kind and event kind, for example `visit/Walk completed`: `pee:yesno`, `poop:yesno`, `water:yesno`, `minutes:count(0–240)`.
  - Field definitions: `{ id, label, type:'yesno'|'count'|'choice', options?:string[], hideWhen?:'no'|'zero'|'skipped' }`.
- **`POST /api/events`** validates `data` against the template. Unknown fields are 400 with `code:'unknown_field'`.
- **`GET /api/diary`:** for customers, drops values matched by `hideWhen` and returns `fields:[{ label, type, value }]`. Staff get every value plus `hidden:true` markers.
- **`renderDiaryVisits()`** gains an optional `fieldsFor(event)` argument.

**Edge cases and failure modes**
- **Older events have no `data`.**
- **Editing a template** affects only new events, because labels are stored resolved at publish time.
- **Hide rules** must never hide medication answers: medication fields can't use `hideWhen`.

**Handoff contract for Codex**
```js
// GET /api/portal → reportFields:{ [serviceKind]: { [eventKind]: FieldDef[] } }
// FieldDef = { id:string, label:string, type:'yesno'|'count'|'choice', options?:string[], min?:number, max?:number }
// POST /api/events adds data:{ [id]: boolean|number|string }
// GET /api/diary events[i].fields: [{ label:string, type:string, value:boolean|number|string, hidden?:true /*staff only*/ }]
```

### C2.5: Care record: profile versions, per-pet timeline, private feedback · Phase 2 · needs C2.4 for fields in the timeline
**Why Claude:** snapshotting history into bookings, a merged paged timeline across tables, and owner-scoped feedback. This is the "longitudinal record" wedge.

**Design**
- **New tables:**
  - `pet_profile_versions(id INTEGER PRIMARY KEY, pet INTEGER NOT NULL REFERENCES pets(id), name TEXT, species TEXT, details TEXT, created INTEGER NOT NULL)`
  - `visit_feedback(booking INTEGER PRIMARY KEY REFERENCES bookings(id), score INTEGER NOT NULL CHECK(score IN (-1,0,1)), comment TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL)`
  - `ALTER TABLE booking_pets ADD COLUMN profile_version INTEGER`
- **Versions and snapshots:** `POST /api/pets` writes a version on every change. Confirming a booking (`POST /api/status` with Confirmed) snapshots the latest version id into `booking_pets.profile_version`.
- **Staff view:** booking cards show the snapshotted profile, with "updated since" when newer.
- **Timeline:** `GET /api/pets/:id/timeline?before=` (owner or staff), merging visits, events (with fields), vaccines (C2.2, if present) and profile changes, newest first, paged by `(at, type, id)`.
- **Feedback:** `POST /api/feedback` (customer, own Completed booking, editable for 7 days). `GET /api/feedback?days=30` (staff) returns counts per score and recent comments.

**Edge cases and failure modes**
- **Pets created before versioning:** create version 1 lazily on first read.
- **Profile changes while a booking is Requested** don't snapshot until confirmation.
- **Deleted pets don't exist** (there's no delete route). Keep it that way until a privacy decision is made.

**Handoff contract for Codex**
```js
// GET /api/pets/:id/timeline?before=cursor → { entries:TimelineEntry[], next:string|null }
// TimelineEntry = { type:'visit'|'event'|'vaccine'|'profile_change', at:number, id:number,
//   booking?:number, service_name?:string, kind?:string, notes?:string, fields?:FieldValue[],
//   has_photo?:boolean, summary?:string, changed?:string[] /* profile field keys */ }
// POST /api/feedback (customer) { booking:number, score:-1|0|1, comment?:string(≤1000) } → {}
// GET /api/diary visits[i].feedback: { score, comment } | null   (owner only)
// GET /api/feedback?days=30 (staff) → { counts:{ '-1':n, '0':n, '1':n }, recent:[{ booking, customer, score, comment, created }] }
// bookings[i] (staff) pets snapshot: profile_version:number, profile_updated_since:boolean
```

### C2.6: Internationalisation plumbing · Phase 2 · needs the C1.1 error codes
**Why Claude:** a language contract shared by the public site, portal, server errors, dates and money, plus storing the choice per user.

**Design**
- **New `assets/i18n.js`:** exports `locale()` (reads `localStorage['myo-language']`, falls back to `document.documentElement.lang`, then `'en'`), `t(key, params)`, `formatDate(ms, style)`, `formatMoney(cents)` and catalogs `en` and `es`.
- **`assets/home.js` `setLanguage()`** stays the source of truth for the public site; the portal reads the same storage key.
- **Migration:** `ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'`. New route `POST /api/locale` `{ locale:'en'|'es' }`, returned in `publicUser()`.
- **Server errors** keep their English `error` text for logs. Clients show `t('error.'+code)` when a translation exists, otherwise `error`.
- **This task converts the infrastructure only:** helpers in `assets/portal.js` that format dates and money (`money`, `date`, `appointmentTime`, `appointmentDay`, `day`) move into `assets/i18n.js`. Codex X2.6 moves the strings.

**Edge cases and failure modes**
- **Free text** from customers and Myomi stays untranslated.
- **Spanish strings are longer:** keep layouts tested at 320 px.
- **Pluralisation:** `t()` supports `{ one, other }` entries.

**Handoff contract for Codex**
```js
// import { t, locale, formatDate, formatMoney } from './i18n.js'
// t('booking.review.title') ; t('booking.pets.count', { count:2 }) ; t('error.time_reserved')
// Catalog file layout: assets/i18n.js exports const catalogs = { en:{...}, es:{...} } with dotted keys
// POST /api/locale { locale:'en'|'es' } → {} ; publicUser().locale
```

### C2.7: Staff customer records and private notes · Phase 2
**Why Claude:** new staff-only data that must never leak to customers. It needs access-rule tests and changes `petsFor()` semantics for staff.

**Design**
- **New table:** `staff_notes(id INTEGER PRIMARY KEY, subject_type TEXT NOT NULL, subject_id INTEGER NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)`, with `subject_type ∈ client|pet`.
- **Routes:**
  - `GET /api/clients?q=&before=` (staff, paged by name then id).
  - `GET /api/clients/:id` (staff): the profile, pets (full `details`), bookings summary, vaccines, home-access summary and notes.
  - `POST /api/staff-notes` (staff) for create and update.
- **Tests:** add a case to `tests/routes.test.mjs` that a customer requesting `/api/clients/1` gets 403, and an assertion that `staff_notes` never appears in any customer payload (scan the response JSON).

**Handoff contract for Codex**
```js
// GET /api/clients?q=&before= → { clients:[{ id, name, email, pets:[{ id, name, species }], upcoming:number, last_visit:number|null }], next }
// GET /api/clients/:id → { client:{ id, name, email }, pets:[Pet], bookings:[BookingRow], notes:[{ id, subject_type, subject_id, body, updated }] }
// POST /api/staff-notes { id?:number, subject_type:'client'|'pet', subject_id:number, body:string(≤3000) } → { id }
```

---

## Phase 3 (needs owner decisions: payment provider, policies, email provider)

### C3.1: One money ledger and payments · Phase 3 · needs C1.1 and a provider choice
**Why Claude:** money correctness, webhook signature verification, idempotent settlement and refunds that update lines. Unlike Time To Pet, refunds and credits are ledger lines from day one.

**Design**
- **New tables:**
  - `ledger_entries(id INTEGER PRIMARY KEY, booking INTEGER REFERENCES bookings(id), owner INTEGER NOT NULL, kind TEXT NOT NULL, cents INTEGER NOT NULL, provider_ref TEXT, created INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '')`, with `kind ∈ charge|refund|credit|tip|adjustment`
  - `payment_intents(booking PRIMARY KEY, provider_id TEXT UNIQUE, status TEXT, amount INTEGER, updated INTEGER)`
- **Flow:** authorise at confirmation (or within N days of the start, for bookings far ahead); capture at completion (Wag!-style). Refunds are new `refund` lines; a booking's balance is derived from its lines.
- **Webhook:** a `public` route `POST /api/payments/webhook` with signature verification. It uses the provider event id as its idempotency key, because the existing table is per user.
- **New `lib/payments.mjs`** wraps the provider, with a fake for tests.

**Edge cases and failure modes:** authorisation expiry; partial and multiple refunds; replayed or out-of-order webhooks; amount changes from late pickup (C2.1) needing an incremental capture or a second charge; never marking a booking "paid" from a browser redirect alone.

**Handoff contract for Codex:** `bookings[i].payment:{ status:'none'|'authorized'|'captured'|'refunded'|'failed', balance_cents, lines:LedgerLine[] }`; `POST /api/payments/start { booking } → { redirect_url }`; `POST /api/tips { booking, cents } → {}`; `PUT /api/auto-tip { percent:0–30 }`.

### C3.2: Cancellation policy · Phase 3 · needs C3.1
- **Design:** `services.cancel_cutoff_hours` (default 24) and `services.cancel_fee_percent` (default 50).
- **Route:** `POST /api/status` with Cancelled (customer) computes the fee from the Eastern-time cutoff and writes ledger lines. Staff cancellations waive it.
- **New route:** `GET /api/cancellation-preview?booking=` → `{ fee_cents, cutoff:number }`.
- **Edge cases:** overnight stays (nightly lines); Requested bookings are always free; change requests don't count as cancellations.

### C3.3: Recurring series with projections · Phase 3 · needs C1.1, C1.2
- **Design:** `recurring_series(id, owner, service, pets TEXT /*JSON ids*/, weekdays INTEGER, start_minute INTEGER, from_day TEXT, until_day TEXT, auto_approve INTEGER, paused INTEGER)`. A generator creates Requested or Confirmed bookings for the next N weeks (default 4), on a cron Durable Object alarm on the Worker or on read on Node.
- **Routes:** `/api/series` (create, pause, skip-date), returning projections `{ date, starts, status:'projected'|'booked'|'conflict' }`.
- **Edge cases:** closed exceptions turn into `conflict` projections; daylight saving; price changes apply only to future generation; skipping one occurrence; series without a pet.

### C3.4: Fee rules · Phase 3 · needs C1.1
- **Design:** `fee_rules(id, code, label, kind:'weekend'|'holiday'|'after_hours'|'short_notice', amount_type:'flat'|'percent', value, params TEXT, active)`, applied in `quote()` in a fixed order. Holidays come from a staff-managed list.
- **Edge cases:** stacking order and rounding (round each line); re-quoting on change requests.

### C3.5: Packages on the ledger · Phase 3 · needs C3.1
- **Design:** `packages(id, name, service, credits, cents, expires_days)` and `package_balances(owner, package, remaining, expires)`. A booking consumes a credit as a `credit` ledger line; cancelling restores it.

### C3.6: Notification outbox · Phase 3 · needs an email provider
- **Design:** `outbox(id, user, template, params TEXT, locale, status, attempts, send_after, sent_at, dedupe_key UNIQUE)`, written in the same transaction as the triggering change. A sender drains it on a Durable Object alarm or cron. Dedupe keys prevent repeat sends.
- **Templates:** request received (to staff), approved, change decided, visit started or completed, vaccine due (30 days and 7 days), keys to return.
