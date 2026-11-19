# Development handoff

Updated November 19, 2026 against `b2519ec` on `main`. Finding IDs in the older remediation notes refer to [MYO_AUDIT.md](MYO_AUDIT.md); `UX-nn` IDs refer to the [UX flow audit](docs/ux-flow-audit.md). Cloudflare has been exercised locally only; no live deployment exists.

**Where to look first:** the [UX flow audit](docs/ux-flow-audit.md) and its two execution plans, [Claude's](docs/plans/claude-ux-plan.md) (server rules, data and pure modules; CUX tasks, with handoff notes per batch) and [Codex's](docs/plans/codex-ux-plan.md) (screens, copy and browser tests; DUX tasks). The earlier roadmap is in [claude-plan.md](docs/plans/claude-plan.md) / [codex-plan.md](docs/plans/codex-plan.md) (Phases 1–3, all built), and the [launch iteration report](docs/audits/2026-11-18-launch-iteration.md) records the launch pricing and care integrations.

## 1. Where things stand

- **Hosting is decided: Cloudflare.** One Worker serves the site and portal as static assets and forwards `/api/` to a single Durable Object (`MyoApi`) that owns the SQLite database. Photos are in R2. The same app also runs on Node for local development and the fast tests. Deploy steps are in the README ("Deploy to Cloudflare").
- Security hardening, migrations, the 30-minute booking grid, paged history and diary, and the module split are done and tested on both runtimes.
- The portal passes an end-to-end browser run in Chromium on both runtimes. Safari and real phones are untested.
- **Backup and restore:** owners download one file with everything (`GET /api/backup`), a daily copy goes to a second destination (`MYO_BACKUP_DIR` on Node, the `myo-backups` R2 bucket on Cloudflare), and `scripts/restore.mjs` restores into a new, empty installation.
- **Launch rules are the default** (`MYO_PRICING_MODE` unset): prices, peak dates and policies come from `assets/myo-config.js`. Owner decisions of November 19, 2026 are enforced: one Meet & Greet per client, booked 24 hours ahead; a 50% deposit due 48 hours after the request; Myomi confirms once the deposit is in; cancelling 7+ days ahead is free, later Myomi keeps 50% of the deposit paid. `MYO_PRICING_MODE=catalog` keeps the earlier staff-set prices and rules (most test fixtures use it).

### Current booking and UX baseline

- **Booking:** the server side of the five-step booking flow is built: guest prices and a ZIP check before sign-in, day-by-day availability with a fee-free default day, holds, requests with deposits and terms, the visit resource with next steps, and a self-refreshing diary feed. The screens are Codex's DUX tasks; DUX-01 (navigation and contrast), DUX-02 (shared shell and routes), DUX-03 (compact booking controls) and DUX-05 (intake stepper) are done, DUX-04 and DUX-06 to DUX-12 are open.
- **Staff:** weekly hours in Massachusetts time, buffers, date exceptions, extra windows, owner and sitter roles, customer records with private notes, payments and refunds. Both Google review URLs in `assets/review-links.js` are still blank.
- **Not live:** online payment (no Stripe keys), email (no provider; messages and reset links queue in the outbox), and the custom domain.

## 2. Architecture in one page

```
worker.mjs ── static assets (dist/site, built by scripts/build-site.mjs from lib/site.mjs's allow-list)
           └─ /api/* ─▶ Durable Object MyoApi ─▶ lib/api.mjs (route table) ─▶ lib/routes/*.mjs
server.mjs ── same lib/api.mjs and routes, node:http bridge, lib/static.mjs for files (local and tests only)

lib/db.mjs     migrations, get/all/run, transaction(), photos.put/get/delete — over a storage adapter:
lib/stores/    durable.mjs (ctx.storage.sql + transactionSync, R2)   node.mjs (node:sqlite + BEGIN IMMEDIATE, files)
```

- **Requests and responses are Fetch-style** (`Request`/`Response`) everywhere in `lib/`. Handlers get `ctx` (`user`, `data`, `url`, `request`, `match`, `clientAddress`, `cookies`) and return data (sent as JSON) or a `Response`.
- **Adding an endpoint:** add `{ method, path, access, handler }` to a file in `lib/routes/`. `access` is `public`, `user`, `staff` (any staff account) or `owner` (staff with the owner role), enforced before the handler runs. `tests/routes.test.mjs` checks every route's access rule automatically, and `tests/staff.test.mjs` checks that a sitter gets 403 from every `owner` route.
- **Race-freedom rule:** `transaction(fn)` must be synchronous (it throws on an async callback). Both runtimes process one request's transaction without interleaving: Node is a single process, and on Cloudflare all API traffic goes to one Durable Object instance (`idFromName('myo')`). Do any `await` (R2 upload, password hash) **before** the transaction, then re-check state inside it. `POST /api/events` shows the pattern.
- **Schema version** is stored in the `meta` table (`schema_version`, now 31; migrations 5–8 add idempotency, trusted devices, checkout holds, then weekly hours and date exceptions; 9–13 add itemised booking lines, change requests, the departure check, service kinds and overnight settings; 14 adds vaccines and agreements; 15 the home-access vault; 16 report-card answers; 17 profile versions and visit feedback; 18 each account's language; 19 staff notes; 20 fee rules and holidays; 21 the money ledger, checkout sessions, webhook events, auto-tip and cancellation fee; 22 cancellation terms per service; 23 recurring visits; 24 packages; 25 the notification outbox; 26 staff roles and switched-off accounts; 27 care intakes, a booking's Meet & Greet link, primary pet and proposed reschedule price; 28 client phone, address and ZIP; 29 request, confirmation and cancellation times; 30 password-reset tokens; 31 deposits, cancel reasons, accepted terms, and one Meet & Greet per client), because Durable Objects forbid `PRAGMA user_version`. Migrations must be safe to re-run. Migration 4 adds `events.photo_key`; the old `photo` BLOB column is no longer read (it only ever held test data).
- **Name the columns in every `INSERT`.** Migrations add columns, and a positional `INSERT … VALUES(…)` breaks when they do; this happened twice in Phase 2.
- **Rate limits** are in memory. On Cloudflare they live in the single Durable Object, keyed by `CF-Connecting-IP`.

## 3. API reference

- `POST /api/bookings` and `POST /api/reschedule` accept an optional `start` (epoch ms) alongside `slot` (window id): inside the window, on a 30-minute step, in the future, conflict-free. Without `start` the window start is used.
- `GET /api/portal` returns `slots` as bookable start times (`{ id: windowId, starts, ends: windowEnd, service_ids }`) and `windows` (raw published windows). It no longer returns `events`. `bookings` holds upcoming and in-progress bookings plus the newest 20 past ones; `history_next` is the cursor for the rest. For staff, `pets` holds only the pets those bookings reference.
- `GET /api/history?before=<cursor>` → `{ bookings, pets, next }`, 20 per page, newest first.
- `GET /api/diary?pet=&visit=&before=<cursor>` → `{ visits, events, pets, next }`, 10 visits per page with all their updates. Cursors are `<starts>.<id>`; `next` is `null` on the last page.
- **Drafts (O2):** `assets/drafts.js` records every field that differs from its rendered default, per form identity (`data-action|data-id|status`), before each re-render, and restores it afterwards (the booking form re-runs `updateQuote` as service and day are restored). It also stores drafts in `sessionStorage` (`myo-drafts:<user id>`, 24-hour expiry) so they survive a reload. Saved forms are marked `data-submitted` and dropped; sign-out clears all drafts. Chosen photos survive re-renders through `DataTransfer` but not reloads.
- **Accounts:** `POST /api/password` `{ current, password }` changes the password, ends other sessions and forgets other recognised devices. `POST /api/signout-all` ends every session. `/api/portal` returns `account.sessions`. Lockouts (`passwordGuard` in `lib/auth.mjs`): 8 failures per account and address per 15 minutes, 50 per account per hour from unrecognised devices, and a recognised device (`myo_device` cookie, hashed in `trusted_devices`) gets its own 8-per-15-minutes allowance instead.
- **Idempotency:** any signed-in POST may send `Idempotency-Key` (16–100 of `[A-Za-z0-9_-]`). The first request runs; a repeat with the same key and body gets the stored response with `Idempotent-Replay: true`; a repeat while the first is still running gets 409; the same key with a different body gets 422. Only successes are stored, for 24 hours, per user. Routes opt out with `idempotent:false` (the restore routes do). The portal sends a key per form submission, retries twice on a dropped connection, and keeps the key for a manual retap.
- `GET /api/backup` (staff) streams `myo-backup-<date>.json.gz`: `{ format, version, schema_version, created, tables, photos }`, no sessions. `POST /api/restore/photo` `{ key, photo }` and `POST /api/restore` (the parsed backup, up to 50 MB) only work while the installation has no customer data; `scripts/restore.mjs` drives them. Routes can raise the 4 MB body limit with `maxBody`.
- `GET /api/photos/<id>` streams from R2 (or the local photos folder) with `Cache-Control: private, max-age=3600`.
- Sign-in/register: 429 after 30 requests per minute per address; sign-in 429 after 8 failures per account in 15 minutes. Malformed URLs return 404. Uploaded photos are re-written without metadata; a corrupt image returns 400.

**Itemised prices and error codes (C1.1).**
- **Pricing:** `lib/pricing.mjs` `quote()` prices every hold and request on the server: a `base` line plus `extra_pet` (`services.extra_pet_cents` × extra pets).
- **Quote endpoint:** `POST /api/quote` `{ service, pets, slot, start }` → `{ starts, ends, lines, total_cents }`.
- **Holds:** `POST /api/checkout-hold` also returns `lines` and `total_cents`.
- **Price check:** `cents` on holds and requests must equal `total_cents`, otherwise 409 `{ code:'price_changed', total_cents }`.
- **Storage:** bookings store their lines in `booking_lines`, and `bookings.cents` is the total. `GET /api/portal` bookings carry `lines`; older bookings show one `base` line.
- **Error shape:** errors are `{ error, code?, ...details }`. Codes so far: `time_unavailable`, `window_too_short`, `time_reserved`, `hold_expired`, `price_changed`.

**Change requests (C1.2).**
- **Customer, Confirmed visit:** `POST /api/reschedule` creates a Pending `booking_changes` row and returns `{ change }`. The visit keeps its confirmed time. A newer request replaces an older pending one.
- **Requested visits and staff moves:** these still move directly.
- **Staff:** `POST /api/changes/decide { id, decision:'approve'|'decline' }`. Approval re-checks the time, and returns 409 `time_reserved` or `time_unavailable` if it's gone, leaving the change pending.
- **Customer:** `POST /api/changes/withdraw { id }`.
- **Automatic endings:** cancelling a visit withdraws its pending change; starting the visit declines it.
- **Portal data:** bookings carry `pending_change` and `last_change`.

**Departure check (C1.3).**
- **Completing a visit:** `POST /api/status` with `Completed` requires `secured:boolean` (400 `departure_check_required`). When `secured:false`, it also needs `secure_note` of 3–500 characters (400 `secure_note_required`).
- **Stored and returned:** as `bookings.departure_check` `{ secured, note, at }`, returned on bookings and diary visits; `null` before completion.
- **Staff form:** the checkbox `secured` and the note `secure_note`. **Complete visit** stays disabled until one of them is answered.
- **Customer diary:** shows "🔒 Home secured at …" or "⚠️ Not fully secured: …".

**Service kinds and meet & greet (C1.4).**
- **Kinds:** every service has `kind` (`visit`, `meet` or `overnight`), defined in `serviceCatalog` in `lib/domain.mjs`. Migration 12 marks existing overnight services.
- **Meet & Greet:** must be free (400 `meet_is_free`), and books through the normal quote, hold and request flow at $0.
- **New customers:** `GET /api/portal` gives customers `first_visit: true` until they have a completed visit.

**Overnight stays (C2.1).**
- **Requests:** a service with `kind:'overnight'` is priced per night (`services.cents`, plus `extra_pet_cents` per extra pet per night). Requests send `{ arrive, depart }` (epoch ms on the half hour) instead of `{ slot, start }`. Quote lines are `nightly` and `extra_pet`.
- **Nights:** a stay's nights are the Eastern dates from arrival up to, not including, departure: 1–28 nights.
- **Availability:** each night must start on a weekday in `schedule_settings.overnight_days`, and no day of the stay, departure day included, may be a closed date (409 `night_unavailable` with `day`).
- **Conflicts:** confirmed stays don't overlap each other. Daytime visits are allowed mid-stay, except over the 30-minute arrival and departure blocks; `clashes()` in `lib/scheduling.mjs` decides.
- **Choosing dates:** customers get `overnight_nights` (the next 60 bookable night dates), and `/api/availability` adds `nights` for overnight services. Stays are never offered as grid start times.
- **Staff settings:** `POST /api/schedule` accepts `overnight_days` and `late_pickup_grace` (minutes; omitted values are kept).
- **Late pickup:** completing a stay after the planned pickup plus the grace adds a `late_pickup` line: half a night, or a whole night beyond 8 hours.
- **Not yet supported:** stays can't be rescheduled (409 `stay_reschedule_unsupported`); cancel and rebook.
- **Diary:** overnight visits carry `nights:[{ date, event_ids }]`. New activity kinds: `Arrival`, `Evening check-in`, `Morning check-in`, `Departure`.
- **Minimal UI:** date and time fields on the booking form, and the night checkboxes and grace field in Settings. The full calendar is Codex X2.8.

**Compliance gates (C2.2).** In launch mode a complete care intake and a completed Meet & Greet (once per client) are always required before a paid request; the gates below are **opt-in**: none applies until Myomi sets it up, so existing customers aren't blocked.
- **Vaccines:** `POST /api/vaccine-requirements { species, names }` (staff; an empty list turns the gate off). Species are matched loosely: dog, puppy and canine count as `dog`.
- **Agreement:** `POST /api/agreements { title, body_en, body_es }` (staff) publishes the next version. Customers read `GET /api/agreement` and accept with `POST /api/agreement/accept { version }`.
- **Meet first:** applies only while a Meet & Greet service exists.
- **Customer vaccine records:** `POST /api/vaccines { pet, name, given?, expires }` and `POST /api/vaccines/document { id, document }`. A document is a PDF or image of at most 5 MB, stored in R2, downloaded only by its owner or staff, and included in backups. Staff mark records with `POST /api/vaccines/verify { id }`.
- **Blockers:** `lib/compliance.mjs` `blockers()` reports `vaccine_missing`, `vaccine_expired`, `vaccine_expires_during`, `agreement_required` and `meet_required`.
  - Quotes return them as `blockers`, and `GET /api/blockers` checks a choice.
  - Holds and requests refuse with 409 `{ code:'blocked', blockers }`.
- **Portal data:** pets carry `vaccines` with `status` (`ok`, `due_soon`, `expired` or `missing`), and the response includes `requirements`.
- **Don't switch gates on before the UI exists:** customers can't add vaccines or accept an agreement from the portal yet (Codex X2.1 and X2.2). Until then, a blocked customer only sees the refusal message.

**Home-access vault and key custody (C2.3).**
- **Storage:** customers' entry instructions are encrypted with AES-GCM (`lib/vault.mjs`, key `MYO_VAULT_KEY`, bound to the owner) in `home_access`. Backups carry ciphertext only, so a restore needs the same key.
- **Customer:** `GET` and `POST /api/home-access` (`{ method, instructions ≤1000, key_label? }`; not idempotency-keyed).
- **Staff reveal:** `GET /api/home-access/booking/:id` works only for an In Progress visit, or a Confirmed one inside the early-start window (otherwise 403 `access_not_yet` with `available_from`). Every reveal is logged in `home_access_log`.
- **Keys:** `POST /api/keys { owner, key_status:'with_client'|'with_myomi'|'returned' }`.
- **Staff portal:** each booking carries `home_access: { method, key_status }` (never the instructions), plus `keys_to_return` for keys held with no booking ahead.
- **Configuration and errors:** a missing key returns 503 `vault_unconfigured`; Node in production refuses to start without it. Rotate with `MYO_VAULT_KEY_PREVIOUS`; a key that can't open a record gives 500 `vault_decrypt_failed`.

**Report cards (C2.4).**
- **Templates:** `reportFields` in `lib/domain.mjs` defines structured answers per service kind and activity (`yesno`, `count` or `choice`), sent to the portal as `reportFields`.
- **Publishing:** `POST /api/events` accepts `data: { [fieldId]: value }`, validated against the template (400 `unknown_field` or `invalid_field`). Answers are stored in `events.data` with their labels as published.
- **Diary:** events carry `fields: [{ label, type, value }]`. Customers don't see answers whose template says `hideWhen` (a "no" or a zero); staff see them with `hidden:true`. Medication answers are never hidden.
- **Display:** `renderDiaryVisits()` shows answers as chips. The publish form's inputs are Codex X2.4.

**Care record (C2.5).**
- **Profile versions:** every pet-profile save that changes something adds a row to `pet_profile_versions`.
- **Snapshots:** confirming a booking records each pet's version in `booking_pets.profile_version`. Staff booking rows carry `pet_profiles: [{ pet, version, updated_since }]`, and `GET /api/profile-versions/:id` (owner or staff) returns that snapshot.
- **Timeline:** `GET /api/pets/:id/timeline?before=` (owner or staff; anyone else gets 404) returns 30 entries per page, newest first. Entry types are `visit`, `event` (with role-filtered `fields`), `vaccine` (when a given date exists) and `profile_change` (with the `changed` field keys). The cursor is `at.rank.id`.
- **Feedback:** `POST /api/feedback { booking, score:-1|0|1, comment? }` works for the customer's own completed visit and can be changed for 7 days (409 `feedback_closed` after). The owner's diary visits carry `feedback`. Staff get `GET /api/feedback?days=30` → `{ counts, recent }`.

**Languages (C2.6).**
- **`assets/i18n.js`:** `locale()` reads the same `myo-language` choice as the public site. It also provides `t(key, params, language)` (placeholders, plus `{ one, other }` plurals), `formatDate(ms, 'visit'|'day'|'time'|'date', language)` in Massachusetts time, and `formatMoney(cents, language)`.
- **Spanish errors:** every server error code has a Spanish message (`error.<code>`). `tests/i18n.test.mjs` scans `lib/` for codes and fails when one is missing.
- **Saved per account:** `users.locale`, `POST /api/locale { locale:'en'|'es' }`, returned in the session. The portal syncs it from the reader's choice, for messages sent outside the portal later.
- **The portal is bilingual** (Codex X2.6): portal phrases go through `t()` with English and Spanish in `assets/ui-copy.js`, and error codes have both languages in `assets/i18n.js`. New UI text needs an entry in both, or `tests/i18n.test.mjs` fails.

**Staff customer records (C2.7).** All routes are staff-only.
- **List:** `GET /api/clients?q=&before=` returns 20 customers per page by name, searched by name or email. Each has `pets`, `upcoming` and `last_visit`; `before` is the last customer's id.
- **Record:** `GET /api/clients/:id` returns the customer, their pets (full details and vaccines), the last 50 bookings, the `home_access` summary (no instructions) and `notes`.
- **Notes:** `POST /api/staff-notes { id?, subject_type:'client'|'pet', subject_id, body ≤3000 }` and `POST /api/staff-notes/delete { id }`. Notes are never in any customer response, which `tests/clients.test.mjs` checks.

**Fee rules (C3.4).** Staff manage `GET`/`POST /api/fee-rules` (`{ id?, code, label, kind:'weekend'|'holiday'|'after_hours'|'short_notice', amount_type:'flat'|'percent', value, params?, active? }`), `POST /api/fee-rules/delete { id }`, `POST /api/holidays { day, name }` and `POST /api/holidays/delete { day }`.
- **Pricing:** every quote, hold and request is priced by `priceBooking()` in `lib/pricing.mjs`: the service lines plus one `fee` line per matching active rule (`lib/fees.mjs`), applied by kind (weekend, holiday, after hours, short notice) and then id, each line rounded on its own. Percentages are of the service lines.
- **Params:** `weekend { days:[0–6] }` (default Sat and Sun; a stay counts each matching night at the per-night amount), `holiday` (dates in `holidays`), `after_hours { before:'HH:MM', after:'HH:MM' }` (visits only), `short_notice { hours:1–168 }`.
- **Booked prices never change** when rules change; rescheduling keeps the original lines. Both tables start empty.

**Money (C3.1).** Every payment, refund and credit is a row in `ledger_entries`, and a booking's `payment` is derived on each read (`lib/ledger.mjs`): `{ status:'none'|'due'|'pending'|'partial'|'paid'|'refund_due'|'refunded', due_cents, paid_cents, refunded_cents, credit_cents, balance_cents }`. A request owes nothing; a cancelled booking owes its `cancel_fee_cents`.
- **Online payment** is off unless `MYO_PAYMENTS=stripe` with `MYO_STRIPE_SECRET_KEY` and `MYO_STRIPE_WEBHOOK_SECRET` (`MYO_PAYMENTS=fake` is for tests and refused in production). The portal carries `payments_enabled`.
- **Checkout:** `POST /api/payments/start { booking }` (customer) → `{ redirect_url }` for Stripe Checkout for the balance; an open session for the same amount is reused. The return URL proves nothing: the portal says the payment is being confirmed.
- **Webhook:** `POST /api/payments/webhook` (public, raw body) verifies Stripe's `t=`/`v1=` signature within five minutes, stores the event id (replays are `duplicate`) and records `payment` lines from `checkout.session.completed`/`async_payment_succeeded` when paid. `expired` and `async_payment_failed` close the session. `refund.created`/`refund.updated` record dashboard refunds once. Point Stripe at `https://<origin>/api/payments/webhook` with those event types.
- **Staff:** `POST /api/payments/record { booking, cents, method:'cash'|'check'|'other', note? }` and `POST /api/refunds { booking, cents, method:'card'|'cash'|'check'|'other', note? }`. Card refunds go through Stripe, split across card payments newest first, with idempotency keys fixed by what is already refunded. Both work with online payment off (except card refunds).
- **Tips:** `POST /api/tips { booking, cents 100–50000 }` (customer, In Progress or Completed) adds a `tip` line and raises the total; `POST /api/auto-tip { percent 0–30 }` adds `Tip (n%)` on completion unless the visit was already tipped. The session user carries `auto_tip_percent`.
- **Reading:** `GET /api/ledger?booking=` (owner or staff) → `{ entries, payment, payments_enabled }`. `GET /api/financials` adds `received { payments_cents, refunds_cents }` (30 days) and `outstanding { owed_cents, refunds_due_cents }`.

**Cancellation policy (C3.2).** In launch mode the deposit-based terms in `lib/cancellation.mjs` apply instead (free 7+ days ahead, then 50% of the deposit paid; `model:'deposit'`). In catalog mode, services carry `cancel_cutoff_hours` (default 24) and `cancel_fee_percent` (default 0; always 0 for a Meet & Greet), set through `POST /api/services`.
- A customer cancelling a **Confirmed** booking after the cutoff owes the percentage of the booking (of one night for a stay; tips excluded). The cancellation must send `accept_fee_cents` equal to the fee, else 409 `cancel_fee_changed { fee_cents }`. Requests are free; staff cancellations waive the fee.
- `GET /api/cancellation-preview?booking=` → `{ cutoff, cutoff_hours, percent, fee_cents, refund_due_cents }`. The cancel dialog shows it.

**Recurring visits (C3.3).** `POST /api/series { service, pets, weekdays:[0–6], time:'HH:MM', from, until?, notes? }` (customer; walks and drop-ins only, 400 `series_visits_only`; at most 10 active, 409 `series_limit`).
- **Generation:** reading `/api/portal` or `GET /api/series` books the next four weeks of every active series (`lib/series.mjs`), each date priced and checked like a single request, as Requested (or Confirmed when staff turned on `POST /api/series/auto-approve { id, auto_approve }`). Dates under two hours away, without published hours, taken, or blocked by compliance gates are not booked.
- **Listing:** `GET /api/series` → `{ series:[{ …, weekdays, time, from, until, paused, ended, auto_approve, projections:[{ date, starts, status:'booked'|'skipped'|'conflict'|'projected', reason?, booking? }] }] }` for eight weeks.
- **Changes:** `POST /api/series/skip { id, day, skip?:false, accept_fee_cents? }` cancels that date's booking under the cancellation policy (or un-skips and books it again); `POST /api/series/pause { id, paused }` stops new dates; `POST /api/series/end { id }` cancels upcoming requests and leaves confirmed visits.

**Packages (C3.5).** Staff `POST /api/packages { id?, name, service, credits, cents, expires_days, active? }` (visit services only, 400 `package_visits_only`); `GET /api/packages` → `{ packages, balances }` (customers see active ones).
- **Buying:** `POST /api/packages/buy { package }` → `{ redirect_url }`; the webhook grants the credits once. Staff `POST /api/packages/grant { user, package, method:'cash'|'check'|'other', cents? }`.
- **Using:** `POST /api/bookings` accepts `use_package:true` and holds the credit that expires first and is valid on the visit date (409 `no_package_credit`). Confirmation writes a `credit` ledger line worth the base price; cancellation returns the credit and reverses the line. The portal carries `package_balances`.

**Notifications (C3.6).** `notify()` in `lib/outbox.mjs` writes an `outbox` row inside the triggering transaction, deduplicated per trigger: `request_received` (staff), `booking_confirmed`, `booking_cancelled` / `customer_cancelled`, `visit_started`, `visit_completed`, `change_decided`, `payment_received`, `keys_to_return` (staff) and `vaccine_due` (30 and 7 days, from a daily scan). Templates render at send time in the recipient's language.
- **Sending:** `drainOutbox()` runs every minute on Node and on a Durable Object alarm (every five minutes) on the Worker, with exponential backoff and six attempts. `MYO_EMAIL=log` marks messages sent (tests). **No email provider is wired in yet**: with `MYO_EMAIL` unset, messages wait as `pending`. Adding a provider is one more entry in `drivers` in `lib/outbox.mjs`.
- **Staff:** `GET /api/outbox` → `{ email_enabled, messages }` (last 100, rendered); `POST /api/outbox/drain {}` sends now.

**Staff roles.** Staff accounts have `role` `'owner'` (the account from `MYO_ADMIN_EMAIL`, and every staff account created before migration 26) or `'sitter'`; the session user carries `role` (`null` for customers).
- **Sitters** start and complete visits, publish updates, reveal home access when allowed, return keys, verify vaccines and read customer records and notes. Approving, declining, cancelling and moving visits, deciding change requests, and every `owner` route are refused with 403 `owner_only`.
- **Owners** manage staff: `GET /api/staff`, `POST /api/staff { name, email, password, role }`, `POST /api/staff/update { id, role?, disabled? }` and `POST /api/staff/password { id, password }`. Nobody can change their own role or switch themselves off (409 `staff_self`); at least one active owner remains (409 `last_owner`). A role change, switch-off or new password ends that account's sessions; a switched-off account can't sign in (403 `account_disabled`, only after a correct password). Settings has a Staff panel.

**Scheduled backups.** The same file as **Download backup** is written once a day to a second destination: `MYO_BACKUP_DIR` on Node (checked hourly, off when unset) or the `BACKUPS` R2 bucket on Cloudflare (checked by the Durable Object alarm). The newest `MYO_BACKUP_KEEP` (30) are kept; a failure is stored and retried hourly.
- **Owner routes:** `GET /api/backups` → `{ enabled, keep, last_backup, last_error, backups:[{ name, size }] }`, `POST /api/backups/run {}`, and `GET /api/backups/file/<name>` to download one for `scripts/restore.mjs`. Settings shows the last backup or the problem.
- **Size:** the file is built in memory before upload (R2 needs its length). That suits one sitter's data; a large photo library would need a multipart upload.

**Booking flow (CUX, November 19, 2026).** Full request and response shapes are in the Handoff Notes of [the Claude UX plan](docs/plans/claude-ux-plan.md); in short:
- Pure modules for the portal: `assets/portal-route-state.js` (routes and roles), `assets/intake-model.js` (intake fields, groups, validation, draft policy), `assets/visit-state.js` (actions, timeline, next steps, dashboards), `assets/diary-sync.js` (diary refresh controller); `assets/drafts.js` keeps drafts by sensitivity.
- Public: `GET /api/eligibility?zip=`, `POST /api/public-quote`, `GET /api/availability/days?service=`, `GET /api/availability/times?service=&date=`, `GET /api/recovery`, `POST /api/recovery/request`, `POST /api/recovery/redeem`.
- Signed in: `POST /api/contact`, `GET /api/intake/status`, partial `POST /api/intake`, `GET /api/bookings/<id>`, `GET /api/diary/changes?since=`. Quotes carry deposit, notice, peak and `terms`; requests accept `accept_terms_version` and return `reference`, `next_steps`, `timeline` and `notifications`.
- Deposits (`lib/deposits.mjs`): requests owe 50% within 48 hours; `deposit_unpaid` blocks confirmation; with online payment on, unpaid requests expire at the deadline (checked every minute on Node, on the Durable Object alarm and on portal reads).

**Booking holds and weekly hours.** `POST /api/checkout-hold` creates a short hold and `POST /api/checkout-release` releases it. The request flow checks the hold and current availability when submitting. Staff set recurring hours with `POST /api/schedule` and individual-date changes with `POST /api/schedule-exception`.

**Configuration.** Cloudflare needs the `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` and `MYO_VAULT_KEY` secrets, plus `MYO_PAYMENTS=stripe`, `MYO_STRIPE_SECRET_KEY` and `MYO_STRIPE_WEBHOOK_SECRET` to switch on online payment, and a second R2 bucket `myo-backups` for scheduled backups. The Node-only variables (`MYO_DB`, `NODE_ENV`, `MYO_ORIGIN`, `MYO_SECURE_COOKIES`, `MYO_TRUST_PROXY`) are listed in the README.

## 4. Verification

| Command | Runs | Latest result (November 19, 2026, Node v22.23.4) |
|---|---|---|
| `npm test` | all suites on Node | 219 passed |
| `npm run test:worker` | the same suites under `wrangler dev` (`scripts/test-worker.mjs`) | last full run 192 passed, 20 Node-only skipped; the deposit and Meet & Greet suites passed on the Worker afterwards |
| `npm run test:browser` | Chromium: portal flow, holds, booking form, Meet & Greet, accessibility (axe), bilingual pages, care, payments, staff roles, navigation, booking ergonomics, and Codex's newer suites; fails on any console or CSP error | clean on Node before Codex's DUX-05 merge; re-run after later merges |
| `npx wrangler deploy --dry-run` | production bundle | about 190–200 KB, no Node-only modules |

These counts predate Codex's DUX-05 merge (`b2519ec`); run the commands again for current numbers. Playwright is not a dev dependency (see the README). CI (`.github/workflows/test.yml`) runs a syntax check and `npm test` on Node 22 and 24, and `npm run test:worker`; it does not run the browser tests. One Worker run hit a Wrangler start-up flake ("Request was cancelled") that passed on rerun.

**Not run:** a real Cloudflare deployment, Safari/WebKit, Firefox, real phones and their camera and HEIC photos, and Windows since the restore fix.

## 5. What is still open (as of November 19, 2026)

### Decided by the owner on November 19, 2026 (enforced in code)
One Meet & Greet per client (pets have no accounts), booked at least 24 hours ahead; the 48-hour deposit window starts when the request is sent; a late cancellation keeps 50% of the deposit.

### Decisions still needed from the owner
| Decision | Unblocks |
|---|---|
| Public domain | Custom domain on the Worker, the email sending domain, and `sitemap.xml` / `robots.txt` (still pointing at GitHub Pages) |
| Email provider (Postmark or Resend suggested) | Sending the outbox: receipts, deposit notices and reminders, confirmations, password resets |
| Stripe live keys and webhook | Online deposit and balance payment, and automatic expiry of unpaid requests |
| Whether a first request may be sent before the Meet & Greet; whether a new pet needs its own meeting | Linked pending requests in CUX-02 |
| Balance timing beyond "before the visit", no-shows | Payment reminders and no-show handling |
| Peak puppy rate ($44 or $53), Christmas 2026 dates, Connecticut ZIPs | Flags in `assets/myo-config.js` and the service-area check |
| Photo and location consent, data retention, launch content, Google review links | Policy and public copy |

### Open engineering work
- **Claude:** CUX-02's booking-intent controller (`assets/booking-flow-state.js`) and explicit primary-pet pricing (the first pet listed is priced as primary today). See [the Claude UX plan](docs/plans/claude-ux-plan.md).
- **Codex:** DUX-04 and DUX-06 to DUX-12 (guided first booking, honest pricing and deposit review, dashboards and visit workspace, loading and error states, copy reconciliation, regression suite, landing guest preview, confirmation screen). See [the Codex UX plan](docs/plans/codex-ux-plan.md). The financials intro still says payments aren't tracked (UX-21).
- **Earlier usability findings:** the [usability report](docs/audits/2026-11-18-usability-test.md) items are folded into the UX audit's UX-nn list; H1, H2 and M1 are fixed, the confirmed-visit reschedule (M3) became change requests (C1.2), and the phone booking length (H3) and 200 % text (M4) are covered by DUX-03 and DUX-01.

### Engineering and verification
- **First Cloudflare deploy:** never done. It needs Workers Paid (scrypt uses about 40 ms CPU per sign-in), a valid API token, the two R2 buckets (`myo-photos`, `myo-backups`), the secrets (`MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD`, `MYO_VAULT_KEY`) and a check on the `workers.dev` URL, including a first scheduled backup and a restore rehearsal from it.
- **Real devices and browsers:** Safari (macOS and iOS), Firefox, Android Chrome, camera capture, HEIC photos, the software keyboard and screen readers. Only Chromium emulation has been run.
- **Windows:** the restore-script fix in the launch iteration has not been re-run on Windows.

## 6. Recommended next tasks

1. **Owner:** choose the domain and email provider; set up the Cloudflare account and token; decide the open items above.
2. **Claude:** CUX-02 controller, explicit primary pet, then the email driver once a provider exists.
3. **Codex:** DUX-04, DUX-06 and DUX-12 first (they carry the deposit and terms the server now enforces), then the rest.
4. **Together:** first Cloudflare deploy to staging, then a real-device pass (section 4 of the brief below) on iPhone Safari and Android Chrome.

## 7. Usability and UX test for Claude

**Done 2026-11-18 and 2026-11-19:** see [the usability test](docs/audits/2026-11-18-usability-test.md) and [the UX flow audit](docs/ux-flow-audit.md). This brief is kept for the real-device pass. Its H1 (early start), H2 (hold expiry) and M1 (abandoned holds) are fixed, with `tests/early-start.test.mjs` and `tests/browser/holds-smoke.mjs`. Physical devices, Safari, Firefox and screen readers were not available and remain to be tested.

Claude, run a fresh customer and staff usability pass against the latest `main` with fictional data and separate authenticated sessions. Use [the previous friction log](docs/audits/myo-live-ux-friction-log.md) as a retest list, then compare notes with the current build.

1. **First-time customer journey.** Start on the homepage in English and Spanish. Open a service, find the price and available times, register, add a pet, review the hold, edit and resume, submit the request, and find its status. Exercise no availability, a missing pet, expiry, rescheduling, and cancellation. Verify that the UI distinguishes a hold, a request, a confirmed visit, and payment availability.
2. **One-handed staff journey.** Set weekly hours, a buffer, and a date exception. Find the request, approve it, start the visit, take or choose a photo, publish it, and complete the visit. Check whether actions and feedback stay within thumb reach, the software keyboard or floating controls obscure anything, and returning to the diary preserves an unsent draft. Retest the known future-visit start behavior and report its impact.
3. **Customer diary and accessibility.** Confirm that the customer can find the completed visit and refresh, filter, and open the photo. Verify another customer cannot open it. Check keyboard focus, accessible names and announcements, text zoom, reduced motion, swipe versus vertical scroll, and the sticky menu in a short landscape viewport.
4. **Device coverage.** Use Chromium for a reproducible pass at 320 and 390 CSS pixels, plus desktop. If available, use real iPhone Safari and Android Chrome for one-handed navigation, the camera and photo library, rotation, and HEIC behavior. Record emulated and physical-device results separately.

Leave a dated report under `docs/audits/` with the commit, runtime, browsers and devices, what passed, and findings ranked by severity. For each finding include the user impact, steps to reproduce, expected and actual behavior, and a screenshot or recording when useful. Separate confirmed bugs from policy decisions and items you could not test.
