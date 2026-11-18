# Development handoff for Codex

Updated November 18, 2026 against [`0681457`](https://github.com/delinquencies/myomivela/commit/068145742abb91708e8ac797015fe0a3c49d4bbd) on `main`. Finding IDs in the older remediation notes refer to [MYO_AUDIT.md](MYO_AUDIT.md). Cloudflare has been exercised locally. No live deployment has been verified.

## 1. Where things stand

- **Hosting is decided: Cloudflare.** One Worker serves the site and portal as static assets and forwards `/api/` to a single Durable Object (`MyoApi`) that owns the SQLite database. Photos are in R2. The same app also runs on Node for local development and the fast tests. Deploy steps are in the README ("Deploy to Cloudflare").
- Security hardening, migrations, the 30-minute booking grid, paged history and diary, and the module split are done and tested on both runtimes.
- The portal passes an end-to-end browser run in Chromium on both runtimes. Safari and real phones are untested.
- **Backup and restore** exist: staff download one file with everything (`GET /api/backup`, button in the portal); `scripts/restore.mjs` restores it into a new, empty installation. Downloads are manual.

### Current booking and UX baseline

- Customers can preview upcoming times and published prices before signing in. Booking review holds a time for up to 10 minutes, shortened if the appointment starts sooner. Sending the request releases the hold and the visit shows **Waiting for Myomi**. Staff approval checks availability again. Checkout payment and outbound confirmation remain open.
- Staff can set repeating weekly hours in Massachusetts time, visit buffers, date exceptions, and extra windows. The portal has staff and customer dashboard updates, a refresh-on-entry diary, and shared Google review link settings. Both review URLs are still blank.
- The [sitewide audit](docs/audits/myo-sitewide-audit-and-next-steps.md) and [UX friction log](docs/audits/myo-live-ux-friction-log.md) document earlier local runs. The current code already addresses some of that friction, including the service card scroll, the registration shortcut, optional intake skips, and clearer booking status. Retest these before filing them as defects.

## 2. Architecture in one page

```
worker.mjs ── static assets (dist/site, built by scripts/build-site.mjs from lib/site.mjs's allow-list)
           └─ /api/* ─▶ Durable Object MyoApi ─▶ lib/api.mjs (route table) ─▶ lib/routes/*.mjs
server.mjs ── same lib/api.mjs and routes, node:http bridge, lib/static.mjs for files (local and tests only)

lib/db.mjs     migrations, get/all/run, transaction(), photos.put/get/delete — over a storage adapter:
lib/stores/    durable.mjs (ctx.storage.sql + transactionSync, R2)   node.mjs (node:sqlite + BEGIN IMMEDIATE, files)
```

- **Requests and responses are Fetch-style** (`Request`/`Response`) everywhere in `lib/`. Handlers get `ctx` (`user`, `data`, `url`, `request`, `match`, `clientAddress`, `cookies`) and return data (sent as JSON) or a `Response`.
- **Adding an endpoint:** add `{ method, path, access, handler }` to a file in `lib/routes/`. `access` is `public`, `user` or `staff`, enforced before the handler runs. `tests/routes.test.mjs` checks every route's access rule automatically.
- **Race-freedom rule:** `transaction(fn)` must be synchronous (it throws on an async callback). Both runtimes process one request's transaction without interleaving: Node is a single process, and on Cloudflare all API traffic goes to one Durable Object instance (`idFromName('myo')`). Do any `await` (R2 upload, password hash) **before** the transaction, then re-check state inside it. `POST /api/events` shows the pattern.
- **Schema version** is stored in the `meta` table (`schema_version`, now 19; migrations 5–8 add idempotency, trusted devices, checkout holds, then weekly hours and date exceptions; 9–13 add itemised booking lines, change requests, the departure check, service kinds and overnight settings; 14 adds vaccines and agreements; 15 the home-access vault; 16 report-card answers; 17 profile versions and visit feedback; 18 each account's language; 19 staff notes), because Durable Objects forbid `PRAGMA user_version`. Migrations must be safe to re-run. Migration 4 adds `events.photo_key`; the old `photo` BLOB column is no longer read (it only ever held test data).
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

**Compliance gates (C2.2).** Every gate is **opt-in**: none applies until Myomi sets it up, so existing customers aren't blocked.
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
- **The portal still renders in English.** `uiLocale()` in `assets/portal.js` returns `'en'` until Codex X2.6 translates the strings and switches it to `locale()`. Dates, money and error messages already route through it.

**Staff customer records (C2.7).** All routes are staff-only.
- **List:** `GET /api/clients?q=&before=` returns 20 customers per page by name, searched by name or email. Each has `pets`, `upcoming` and `last_visit`; `before` is the last customer's id.
- **Record:** `GET /api/clients/:id` returns the customer, their pets (full details and vaccines), the last 50 bookings, the `home_access` summary (no instructions) and `notes`.
- **Notes:** `POST /api/staff-notes { id?, subject_type:'client'|'pet', subject_id, body ≤3000 }` and `POST /api/staff-notes/delete { id }`. Notes are never in any customer response, which `tests/clients.test.mjs` checks.

**Booking holds and weekly hours.** `POST /api/checkout-hold` creates a short hold and `POST /api/checkout-release` releases it. The request flow checks the hold and current availability when submitting. Staff set recurring hours with `POST /api/schedule` and individual-date changes with `POST /api/schedule-exception`.

**Configuration.** Cloudflare needs the `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` and `MYO_VAULT_KEY` secrets. The Node-only variables (`MYO_DB`, `NODE_ENV`, `MYO_ORIGIN`, `MYO_SECURE_COOKIES`, `MYO_TRUST_PROXY`) are listed in the README.

## 4. Verification

| Command | Runs | Earlier remediation baseline (Node v22.23.4, Wrangler 4.164.0) |
|---|---|---|
| `npm test` | all suites on Node | 49 passed |
| `npm run test:worker` | the same suites under `wrangler dev` (Durable Object SQLite, local R2, static assets) | 41 passed, 8 skipped (Node-only: direct database seeding, backup script, legacy upgrade, Node production checks) |
| `npm run test:browser` | Chromium, phone viewport, full customer and staff flow, unsaved input surviving other saves, reloads and sign-out, a simulated dropped connection while publishing, and the backup download; fails on any console or CSP error | clean on Node |
| `MYO_TARGET=worker npm run test:browser` | the same on the Worker | clean (the database-seeded paging step is skipped) |
| `npx wrangler deploy --dry-run` | production bundle | 40 KB, no Node-only modules |

[GitHub CI for `0681457`](https://github.com/delinquencies/myomivela/actions/runs/44227268734) passed on Node 22 and 24 and in the Worker job. The latest local Chromium audit includes the 390 px booking and diary smoke test. The README records a separate Windows run with 48 of 50 tests passing and two restore CLI exit-code failures also seen on the baseline. This workflow does not run the browser or Windows checks.

**Not run:** a real Cloudflare deployment, Safari/WebKit, Firefox, real phones and their camera and HEIC photos.

## 5. What is still open (as of November 18, 2026)

Done since the usability report: early start limited to the visit buffer (H1), hold expiry shown with fresh-time recovery (H2), and abandoned holds released (M1). Details are in [the report](docs/audits/2026-11-18-usability-test.md#fixes-after-this-report).

### Decisions needed from the owner
| Decision | Unblocks |
|---|---|
| Public domain | Custom domain on the Worker; `sitemap.xml` and `robots.txt` still point at GitHub Pages (O1, P1-8) |
| Rescheduling a confirmed visit: allowed for customers? Needs re-approval? | M3: today it silently returns to "Waiting for Myomi" |
| Cancellation cutoff, no-shows, refunds | Lifecycle rules (D2, P1-4); cancellation copy |
| Required care information before approval | Structured profile rules (P1-5) |
| Email provider and sending domain | Verification, password recovery, request and confirmation emails (S5, P1-6) |
| Payment provider and payment timing | Checkout, receipts and refunds (P1-7) |
| Rates, service area, Google review links, launch content | Public site content (see README "Decisions still needed") |

### UX findings still open (from the usability report)
| ID | Finding | Needs a decision? |
|---|---|---|
| H3 | Booking form on phones: "Review booking" about 2,000 px down (4 weeks of days plus every time) | No |
| M2 | No times published: "Try another service" with one service, no **Check again**, reload needed | No |
| M3 | Customer reschedule of a confirmed visit silently un-confirms it | Yes (above) |
| M4 | 200 % text: Book button covers the wordmark, headline clipped | No |
| M5 | Spanish stops at the portal | Translation review |
| L1–L7 | Cancel dialog title, generic "Saved.", Bookings→Today label, publish button below the fold, two-tab hold wording, landscape menu height, device monospace digits | No |

### Claude plan status
- **Done:** Phase 1 (C1.1–C1.4) and Phase 2 (C2.1–C2.7) are built and tested on both runtimes, with server contracts in §3 and status notes in `docs/plans/claude-plan.md`.
- **Codex next:** the Codex tickets these unblock (X1.6–X1.9, X2.1–X2.9) can start.
- **Gates are off by default:** vaccine requirements, the agreement and meet-first stay switched off until Myomi turns them on, and they shouldn't be turned on before their UI (X2.1, X2.2) ships.
- **Phase 3** waits on the payment provider, cancellation policy and email provider decisions.

### Engineering and verification
- **First Cloudflare deploy:** never done. It needs the R2 bucket, the secrets (`MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD`, `MYO_VAULT_KEY`) and a check on the `workers.dev` URL. Use **Workers Paid**: scrypt uses about 40 ms CPU per sign-in, over the Free plan's 10 ms limit.
- **Real devices and browsers:** Safari (macOS and iOS), Firefox, Android Chrome, camera capture, HEIC photos, the software keyboard and screen readers. Only Chromium emulation has been run.
- **Scheduled off-account backups:** "Download backup" and `scripts/restore.mjs` exist. Still missing are a schedule (a Cron Trigger) writing to a second destination, and a restore rehearsal on the deployed site.
- **Windows:** two restore-script exit-code assertions fail on Windows (README "Known limitations"). They are not reproducible on Linux or in CI.
- **Spanish portal:** account, intake, booking, diary and messages are English only.
- **Second staff account** and staff roles. Today there is one shared staff account.

## 6. Recommended next tasks

1. **No decisions needed:** shorten the booking form on phones (H3), fix the empty-availability state (M2) and the 200 % text collisions (M4), then the wording items (L1–L3).
2. **First Cloudflare deploy and smoke check** once the account exists, then the custom domain with `sitemap.xml` and `robots.txt`.
3. **Real-device pass:** section 4 of the brief in §7 on iPhone Safari and Android Chrome.
4. **Scheduled backups**, once a destination is chosen.
5. **Email, then payments**, after the provider and policy decisions above.

## 7. Usability and UX test for Claude

**Done 2026-11-18:** see [docs/audits/2026-11-18-usability-test.md](docs/audits/2026-11-18-usability-test.md). Its H1 (early start), H2 (hold expiry) and M1 (abandoned holds) are fixed, with `tests/early-start.test.mjs` and `tests/browser/holds-smoke.mjs`. Physical devices, Safari, Firefox and screen readers were not available and remain to be tested.

Claude, run a fresh customer and staff usability pass against the latest `main` with fictional data and separate authenticated sessions. Use [the previous friction log](docs/audits/myo-live-ux-friction-log.md) as a retest list, then compare notes with the current build.

1. **First-time customer journey.** Start on the homepage in English and Spanish. Open a service, find the price and available times, register, add a pet, review the hold, edit and resume, submit the request, and find its status. Exercise no availability, a missing pet, expiry, rescheduling, and cancellation. Verify that the UI distinguishes a hold, a request, a confirmed visit, and payment availability.
2. **One-handed staff journey.** Set weekly hours, a buffer, and a date exception. Find the request, approve it, start the visit, take or choose a photo, publish it, and complete the visit. Check whether actions and feedback stay within thumb reach, the software keyboard or floating controls obscure anything, and returning to the diary preserves an unsent draft. Retest the known future-visit start behavior and report its impact.
3. **Customer diary and accessibility.** Confirm that the customer can find the completed visit and refresh, filter, and open the photo. Verify another customer cannot open it. Check keyboard focus, accessible names and announcements, text zoom, reduced motion, swipe versus vertical scroll, and the sticky menu in a short landscape viewport.
4. **Device coverage.** Use Chromium for a reproducible pass at 320 and 390 CSS pixels, plus desktop. If available, use real iPhone Safari and Android Chrome for one-handed navigation, the camera and photo library, rotation, and HEIC behavior. Record emulated and physical-device results separately.

Leave a dated report under `docs/audits/` with the commit, runtime, browsers and devices, what passed, and findings ranked by severity. For each finding include the user impact, steps to reproduce, expected and actual behavior, and a screenshot or recording when useful. Separate confirmed bugs from policy decisions and items you could not test.
