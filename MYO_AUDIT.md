# MYO_AUDIT.md — independent audit of `delinquencies/myomivela`

- **Commit audited:** `6aad46d` ("Resolve Outfit and Fraunces in inlined HTML previews"), shallow clone, 2026-11-17
- **Method:** read every runtime source file (`server.mjs`, `assets/portal.js`, `assets/diary.js`, `assets/diary-sample.js`, `assets/home.js`, `portal/index.html`, `index.html`, `package.json`, `sitemap.xml`, `robots.txt`) plus README, handoff and the four prior audits in `docs/audits/`.
- **Runtime checks:** I started `server.mjs` on Node v22.23.4 against a throwaway SQLite file in `/tmp` and drove the HTTP API with a script. The repo was not modified (`git status` clean afterwards). The browser UI was **not** executed, and nothing was tested on a phone.
- **Labels:** **[V-run]** = I executed it and saw the result. **[V-code]** = confirmed by reading the code, not executed. **[Suspected]** = plausible from the code, not demonstrated.


> **Remediation update (2026-11-17, branch `audit-remediation`).** The original audit below is preserved unchanged, including its line numbers, which refer to commit `6aad46d`. Fixes since then are recorded in **§7 Remediation log** with a status per finding; the index is in **§8**, and outstanding work is in **§9 Remaining Work for Codex**. Because of the fixes: the scheduling model (D1) now supports several bookings per window; "Availability / calendar" in the feature matrix is now *Implemented (30-minute grid)*, with the portal UI unverified in a browser. Everything else in the matrix is unchanged.

---

## 1. Executive assessment

myo. is a **small, coherent, single-provider pilot app**, not a booking platform. The whole backend is one 342-line Node file (`server.mjs`) using built-in `node:sqlite`, with a vanilla-JS portal and no framework or dependencies. The core loop of *customer requests a time → staff approves → staff starts a visit → staff posts diary updates with photos → staff completes with a summary → customer reads the diary* is real, persists in SQLite, and is consistent end to end. Customer data isolation held up in every test I ran.

Most of what your audit brief lists is **not built**: Stripe/cart/checkout, recurring bookings, packages, care checklists, medication logging as data, GPS/route/distance, messaging, notifications, email, password recovery, and a Spanish portal. None of these are faked in the UI; the README and handoff say so honestly. The "pretending" risk is elsewhere:

1. **The scheduling model only supports one booking per published window** [V-run]. An 8-hour window with one confirmed 30-minute walk offers nothing else afterwards. Staff would have to publish a separate window for every possible start time.
2. **The login/register rate limit is one bucket per socket IP** [V-run]. Behind any reverse proxy, 12 attempts in a minute from anyone locks every user out.
3. **Production HTTPS needs two environment variables or things fail or weaken** [V-run]. Without `MYO_ORIGIN`, every POST from an HTTPS site returns 403; without `MYO_SECURE_COOKIES=1`, session cookies lack `Secure`.
4. **Photo EXIF, including GPS coordinates, is stored and served untouched** [V-run server side; V-code client side].
5. **There are zero automated tests and no CI.**

**Production readiness:** *Not ready for public launch or for taking payments.* It is *reasonable for a supervised private pilot* with one operator, behind HTTPS, after the P0 items below. The prior "Cloudflare Workers + D1 + R2" plan would mean rewriting the transaction and storage layer. A plain Node host with persistent disk and backups is a much shorter path (see §4).

---

## 2. Feature matrix

| Area | Status | Evidence / notes |
|---|---|---|
| Customer registration & sign-in | **Implemented** | `server.mjs:161-177`. scrypt hashes (`:50-52`), 12-char minimum, hashed session tokens (`:101`), HttpOnly + SameSite=Strict cookie (`:94`). Registered and logged in [V-run]. |
| Email verification / password recovery | **Missing** | No route exists. Email is never sent anywhere. |
| Pet profiles | **Partial** | CRUD works (`:220-227`, no delete). Server requires only name and species (`:222`); the "profile" is a client-built JSON blob in a 3,000-char text column (`portal.js:411-417`, groups at `:58-72`). The server does not validate its structure and enforces no vet, emergency contact or allergy fields. |
| Booking request | **Implemented** | Price-snapshot check (`:233`), ownership check (`:236`), window-fit check (`:112-119`). Runs in `BEGIN IMMEDIATE` (`:63-73`). Cross-customer attempts all rejected [V-run]. |
| Availability / calendar | **Partial / design-limited** | Staff publish "windows" (`:277-287`). A booking can only start at `slot.starts` (`:115`). [V-run: after one 30-min booking was confirmed, the 8h window offered no services.] No calendar view, no per-day grid, no buffers, no blocked time, no capacity concept. |
| Scheduling conflicts | **Implemented (narrow)** | Overlap is checked at request and again at confirm (`:117`, `:250-253`). Two customers could both request one slot; confirming the second returned 409 [V-run]. Requested bookings do not hold time. Only Confirmed/In Progress do (`:121`). |
| Rescheduling / cancellation | **Implemented, policy-free** | `:261-269`, `:244-260`. A customer reschedule of a *Confirmed* booking silently drops it back to Requested (`:266`). No cancellation cutoff, fee or refund logic. |
| Shopping cart / Stripe checkout / payments | **Missing** | `grep -i stripe` finds nothing in code. `cents` is stored on the booking (`:20`, `:239`) but never collected. Checkout pages exist only as archived mockups. |
| Recurring bookings / service packages | **Missing** | No schema, API or UI. Only an archived mockup (`docs/archive/.../checkout_recurring_booking`). |
| Admin dashboard & visit management | **Implemented (basic)** | Today / history / services / slots / approve / start / complete (`portal.js:166-189, 235-264`). Single shared staff account bootstrapped from env (`server.mjs:53-61`). No customer search or management, no edit of published updates, no reports, no audit trail. |
| Visit lifecycle | **Implemented** | `transitions` map (`:107-111`), enforced and exercised [V-run]: confirm → start → complete requires a summary (400 without one), and events after completion return 409. |
| Pet care plans / checklists | **Missing** | Care info is read-only free text shown to staff. No per-visit checklist, no scheduled tasks, no reminders. |
| Medication logging | **Partial (label only)** | "Medication" is one of ten activity types (`:106`) with a free-text note. No dose, schedule or "due/missed" data. |
| GPS walk tracking / routes / distance | **Missing** | No `geolocation` use anywhere. "Walk started/completed" are just diary labels (`:106`). README says so (README "Staff app and GPS"). |
| Pet Diary (events, photos, visit summaries) | **Implemented** | `:288-298`, `:181-188`, `diary.js`. Grouped by visit, owner-scoped, photo access checked per request [V-run]. Weak points: no edit/delete, timestamp is publication time only, and an event with empty notes and no photo is accepted [V-run]. |
| Photo upload | **Implemented, with privacy gap** | Magic-byte + size checks (`:128-140`), stored as BLOB in `events`. EXIF GPS preserved [V-run]. |
| Messaging | **Missing** | No table or route. |
| Notifications | **Missing** | Only in-portal status text. Manual "Refresh updates" button (`portal.js:375-391`). |
| Bilingual support | **Partial** | The public homepage and FAQ toggle EN/ES via `data-es` (`home.js:1-47`). The portal, API errors, dates and activity names are English only. |
| Public site | **Implemented** | Static pages are served by the Node server with an allow-list (`server.mjs:303-331`). |
| Mobile (camera, daily admin ops) | **Unverified** | Camera/library inputs and client-side downscaling exist (`portal.js:136-139`, `:313-338`). Nothing was tested on a device. |

---

## 3. Critical findings

Severity here means "what could go wrong in production", not code style.

### Security

**S1 — Rate limiting is keyed on `request.socket.remoteAddress` only** · `server.mjs:143-151` · [V-run] · **High**
Register and login share one bucket of 12 per 60 s per IP. Behind any reverse proxy or Cloudflare tunnel, all visitors share one IP. In my test, 14 bad logins from one address made the *next legitimate login* return 429. Separately, `scryptSync` (`:51`, `:174`) is synchronous and the whole server is single-threaded. Many source IPs, or one shared IP, can stall every request while hashes compute. There is no per-account throttle.

**S2 — HTTPS deployment depends on two opt-in env vars** · `server.mjs:89, 157-160` · [V-run, V-code] · **High (operational)**
The origin check compares against `MYO_ORIGIN` or `'http://' + host`. A request with `Origin: https://example.com` and no `MYO_ORIGIN` returned 403 [V-run]. A mis-set value therefore breaks *all* writes. `Secure` on the cookie is only added if `MYO_SECURE_COOKIES=1`, and nothing fails fast if the process is public but those are unset. The README mentions both variables, but the code does not enforce them.

**S3 — EXIF metadata (including GPS) is kept in photos** · server `:128-140` stores bytes verbatim [V-run: uploaded a JPEG with a GPS marker; the owner's download contained it]. Client `portal.js:317` only re-encodes images over 2.5 MB or of non-JPEG/PNG/WebP type, so a typical phone JPEG under 2.5 MB goes up untouched [V-code]. Photos are visible to the customer and staff only, so the exposure is limited today. It becomes a problem if photos are ever shared, exported, or shown to a different audience. This is also a privacy question for staff location. **Medium.**

**S4 — Minimal HTTP hardening** · `server.mjs:310-312` · [V-run] · **Medium**
Only `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options` are sent. There is no CSP, HSTS or `Permissions-Policy`. Output escaping is consistently applied (`escapeHtml` in `diary.js:1` and the `text()` alias in `portal.js`), so I found no concrete XSS, but there is no defence in depth if one is introduced. A malformed URL such as `/%E0%A4%A` returns **500** and logs a stack trace [V-run] because `decodeURIComponent` at `:314` throws outside the status-aware path.

**S5 — Account lifecycle gaps** · **Medium**
No email verification, no password reset, no change-password, no "sign out everywhere" and no session cleanup outside sign-in (`:100`). The staff account is a single env-bootstrapped credential. The password variable is ignored after first creation (`:58-60`), so rotation means editing the database by hand. Registration reveals whether an email exists (409 at `:170`). There is no audit log of staff actions.

**What held up:** customer isolation is solid in the tested paths [V-run]. A second customer got 404 when cancelling another customer's booking, booking with another's pet, editing another's pet, or fetching another's photo. An anonymous photo fetch returned 401, and non-staff hitting staff endpoints returned 403. Path traversal attempts to `server.mjs` and `.myo/` returned 404 [V-run]. POSTs require `Content-Type: application/json` (`:75`), which is good CSRF hygiene alongside SameSite=Strict.

### Data integrity & reliability

**D1 — One booking per window; availability model is too coarse** · `server.mjs:112-122`, `:250` · [V-run] · **High (product-critical)**
`reserveTime` always starts at `slot.starts`, and confirmation requires a slot whose `starts` equals the booking start. A long window therefore cannot be subdivided. Staff must publish many tiny windows to expose several start times. There are no buffers or travel time, and no concept of more than one staff member.

**D2 — Visit lifecycle has loose ends** · `server.mjs:107-111, 244-260` · [V-code] · **Medium**
- Staff can start a visit any time before or after its scheduled start, with no guard (`:254`).
- A Confirmed booking whose time has passed has no "no-show"/expiry state; it sits forever or must be cancelled by hand.
- Past Requested bookings cannot be confirmed (`:251`), but nothing cleans them up.
- A published diary update can't be edited or deleted, and always carries the publication time, not the activity time (`:296`).

**D3 — No idempotency on writes** · `:239`, `:296` · [Suspected] · **Low–Medium**
The client disables the submit button while a request is in flight (`portal.js:407-409`), but a retry after a mobile network drop can create a duplicate diary event. A request for the same time by the same customer is blocked (`:238`), which mitigates the booking case.

**D4 — Schema management is ad hoc** · `server.mjs:12-28` · [V-code] · **Medium**
Tables are created with `CREATE TABLE IF NOT EXISTS`, and the only migration is one inline `ALTER TABLE` (`:26-28`). There is no schema-version table or migration files. There are no indexes on `events(booking)`, `bookings(owner)` or `booking_pets(pet)` (only `:23-24`). Photos are BLOBs inside the main database, and nothing in the repo does backups. Losing `.myo/data.sqlite` loses accounts, bookings and photos together.

**D5 — `/api/portal` returns everything and does N×M queries** · `server.mjs:189-211` · [Suspected: not measured] · **Medium at scale**
Every load returns all of the user's bookings and events. Staff receive every customer's. For each future slot it runs a conflict query for every service (`:203-209`), and statements are re-prepared on every call (`:30-32`). The diary filters in the browser (`portal.js:190-212`). Photos are served with `Cache-Control: private, no-store` (`:316` applies to the photo route too), so every diary view re-downloads every image.

**Integration consistency: verified [V-run, V-code].** Bookings, booking_pets, events and photos share foreign-keyed rows (`:20-22`, `PRAGMA foreign_keys = ON` at `:13`). Diary reads join through `bookings.owner`. A pet must belong to the booking to receive an event (`:292`, enforced in application code rather than by the database). Price is snapshotted on the booking (`:239`). There is no payment table to be inconsistent with, since payments do not exist. Pet profile edits apply retroactively to past visits (no snapshot), which is minor.

### Operational

**O1 — Hosting mismatch in the repo** · `robots.txt:4`, `sitemap.xml:4-9`, `index.html:42-56` · [V-code] · **Medium**
The sitemap and robots point at GitHub Pages, which cannot run the API. Every "Book" and "Client Portal" link goes to `portal/index.html`, which would show "The care portal needs a running myo. server" (`portal.js:463-467`) on static hosting.

**O2 — Whole-page re-render after each action** · `portal.js:251-264, 446` · [V-code] · **Low–Medium (mobile)**
`render()` replaces `app.innerHTML` after every submit. Unsaved text in other open forms (for example, a second visit's diary note) is lost. There is no draft persistence.

**O3 — Runtime and tooling** · [V-run, V-code]
`node:sqlite` prints an ExperimentalWarning (seen on Node 22.23). `package.json` has no `engines` field, though the README says Node 24. There is no test script, no `.github/` directory and no lint. The `build` script and Tailwind devDependencies serve only the archived mockups.

---

## 4. Architecture concerns

1. **Synchronous SQLite + single process is a *feature* of the current correctness story.** `BEGIN IMMEDIATE` with no `await` inside the transaction (`:63-73`) is why the overlap/confirm race cannot happen today. The documented move to Workers + D1 would remove that: as I understand it, D1 does not offer interactive `BEGIN…COMMIT` from Workers (it uses atomic batches), so the confirm-with-overlap logic would have to be redesigned. Please verify this against current Cloudflare documentation before committing. A single Node host with a persistent volume, nightly backups and photos on disk would deliver launch readiness far sooner, and it keeps the current transaction logic intact.
2. **Everything is in one 342-line file.** Auth, validation, scheduling, API routes, static serving and DDL are interleaved, and the dense one-line style makes review hard. There are no modules and no route table. Adding payments, webhooks, email and recovery to this structure will be painful. Splitting by module is a prerequisite for the Stripe work, not a cosmetic step.
3. **Payment readiness.** The booking model has no payment state, no payments table, no webhook handling and no idempotency keys. The status machine (`:107-111`) has no "Awaiting payment", "Paid" or "Refunded" state. These need business decisions first (when payment is due, refund and cancellation terms, per the README table).
4. **Duplicated domain logic.** Slot availability is computed on the server (`:203-209`) and again in the client (`portal.js:95-99`). Service names are hard-coded in three places (`server.mjs:273`, `portal.js:15-21`). The server only accepts three fixed service names, so adding a service means a code change.
5. **Time zone is hard-coded** to America/New_York (`portal.js:9, 100-101`; `diary.js:2`). "Today" for staff and the day grouping for customers use it, while the staff entry form uses the device's local zone (`portal.js:229`).
6. **Care-data model.** Pet care information as one JSON string in a text column cannot be queried, validated or versioned. Checklists, medication schedules and "required before approval" rules all need structured tables first.
7. **Media in the database.** BLOB photos with `SELECT events.*` loading (`:183`) will bloat backups and memory. An object-storage or file abstraction should come before any volume of photos.

---

## 5. Prioritized fixes

### P0 — before any real customer or payment

| # | Fix | Evidence |
|---|---|---|
| P0-1 | Add automated tests and CI covering booking lifecycle, overlap, isolation, photo auth and the rate limiter. | No tests, no `.github/` |
| P0-2 | Make rate limiting proxy-aware (configured trusted-proxy header) and add a per-account limit. Offload or bound password hashing so it cannot stall the event loop. | `server.mjs:143-151`, `:51`, `:174` |
| P0-3 | Fail fast in production if `MYO_ORIGIN` / secure cookies are not configured. Add HSTS and a CSP. Return 400 for malformed URLs. | `:89`, `:157-160`, `:310-312`, `:314` |
| P0-4 | Strip EXIF/metadata from every uploaded image (re-encode on the client for all images, or on the server). | `portal.js:317`, `server.mjs:128-140` |
| P0-5 | Decide and document backups for the SQLite file. Implement a tested backup and restore procedure. | No backup code anywhere |
| P0-6 | Resolve the hosting decision (Node host vs. Workers/D1) before building more. | README "Production hosting"; §4.1 |

### P1 — important for a usable launch

| # | Fix | Evidence |
|---|---|---|
| P1-1 | Replace "one booking per window" with a bookable start-time grid inside windows, plus optional buffers. | `server.mjs:112-122`, `:250` |
| P1-2 | Add a migration mechanism (version table, ordered migrations) and indexes on FK columns. | `:12-28` |
| P1-3 | Paginate and filter `/api/portal` and the diary on the server. Remove the slot×service query loop. | `:189-211` |
| P1-4 | Add visit-lifecycle guards: no-show/expired state, a sensible "start visit" window, and a policy for rescheduling Confirmed bookings. | `:107-111`, `:254`, `:266` |
| P1-5 | Server-validated structured pet care profile with required fields before approval. | `:222`, `portal.js:58-72` |
| P1-6 | Email verification, password recovery and booking-lifecycle emails (needs a provider and domain). | No routes |
| P1-7 | Stripe Checkout with signed webhooks, a payments table and idempotency (blocked on business decisions). | No payment code |
| P1-8 | Fix the static-hosting mismatch in `sitemap.xml`/`robots.txt` or commit to the Node deployment. | `robots.txt:4`, `sitemap.xml` |

### P2 — improvements

| # | Fix | Evidence |
|---|---|---|
| P2-1 | Edit/correct published diary updates with an audit trail. Store activity time separately. | `:288-298` |
| P2-2 | Add idempotency keys for event and booking creation. | `:239`, `:296` |
| P2-3 | Translate the portal and API messages. Persist language per customer. | `portal.js`, `server.mjs` |
| P2-4 | Split `server.mjs` into modules. Remove duplicated service-name and slot logic. | §4.2, §4.4 |
| P2-5 | Preserve unsaved form input across re-renders. Add photo caching. Make the time zone configurable. | `portal.js:251-264, 446`; `server.mjs:316` |
| P2-6 | Staff account management: rotate password, add a second staff user. | `:53-61` |
| P2-7 | Add a `engines` field and decide whether to depend on experimental `node:sqlite`. | `package.json` |
| P2-8 | Recurring bookings, service packages, care checklists, medication schedules, GPS routes, messaging. These are new product features and need design first. | Not present |

---

## 6. Next five development tasks for Codex (ordered by dependency and impact)

1. **Test harness + CI.** Add `node:test` integration tests that start `server.mjs` with a temp `MYO_DB` and cover: register/login; pets CRUD; booking → confirm → start → events → complete; overlap 409; cancellation permissions; cross-customer 404s on bookings, pets and photos; photo magic-byte validation; the rate limiter. Add `.github/workflows/test.yml` and an `engines` field. *Acceptance: `npm test` passes in CI and fails if any isolation check regresses.* This unblocks safe changes in every later task.

2. **Security and deployment hardening.** Make rate limiting use a configured trusted-proxy header and add a per-account limit. In production mode (`NODE_ENV=production`), require `MYO_ORIGIN` and `MYO_SECURE_COOKIES=1` or exit with a clear error. Add HSTS, a CSP and `Permissions-Policy`. Return 400 on malformed URLs. Strip EXIF by re-encoding all client photos. *Acceptance: new tests prove a legitimate user is not locked out by another IP's failures; photos have no GPS markers; HTTPS config errors fail at startup.*

3. **Schema migrations, indexes and bounded API responses.** Introduce a `schema_version` table and ordered migrations (convert the `ALTER` at `server.mjs:26-28`). Add indexes on `events(booking)`, `bookings(owner,starts)` and `booking_pets(pet)`. Paginate `/api/portal` bookings/events, and add server-side diary filters by pet and visit. Document and script a SQLite backup. *Acceptance: existing databases upgrade in place, a seeded 5,000-event database loads the diary in a bounded response, and backup/restore is exercised in a test.*

4. **Bookable start-time grid.** Change windows into availability ranges with a configurable step (for example 15 or 30 minutes) and optional buffer. Compute valid start times per service server-side, return them from `/api/portal`, and re-check them in `/api/bookings`, `/api/reschedule` and the confirm step. Remove the duplicated client conflict logic. *Acceptance: an 8-hour window yields multiple non-overlapping 30-minute bookings, all existing overlap and confirmation tests still pass, and concurrent confirmation of overlapping requests still returns exactly one success.*

5. **Stripe Checkout (feature-flagged), after the business rules are decided.** Add a `payments` table and a payment state on bookings. Create a Checkout Session from a confirmed booking, handle signed webhooks with idempotency, and block "Start visit" until paid (or per the agreed policy). Show payment status to both roles. *Acceptance: with Stripe test keys, a replayed webhook does not double-record, an unsigned webhook is rejected, and a customer cannot see another customer's payment. This task is blocked on the payment-timing and refund decisions listed in the README.*

---

*Not tested: any browser or phone behaviour, real camera capture, large-photo upload on mobile networks, Safari/iOS HEIC handling, load or concurrency beyond the single-process cases above, and any hosted deployment.*


---

## 7. Remediation log

Statuses: OPEN, IN PROGRESS, RESOLVED, IMPLEMENTED — UNVERIFIED, BLOCKED, DEFERRED. "Verified" below means a test or command I actually ran; the full suite (`npm test`, 22 tests) passed on Node v22.23.4. Node 24 and the GitHub Actions workflow were **not** run. I also checked that tests catch regressions: disabling the metadata stripping and the per-address limit each made the matching test fail.

### S1 — Shared rate-limit bucket / blocking password hashing · High · RESOLVED
- **Files:** `server.mjs`, `tests/api.test.mjs`, `tests/operations.test.mjs`
- **Fix:** client address comes from `MYO_TRUST_PROXY` (`1` = last `X-Forwarded-For` entry, `cloudflare` = `CF-Connecting-IP`). Per-address cap of 30 sign-in/register requests per minute, plus a per-account cap of 8 failed sign-ins per 15 minutes that clears on success. `scryptSync` replaced by async `scrypt` so hashing no longer blocks the event loop. Registration hashes before its check-and-insert, so the two still cannot interleave.
- **Verification:** account locks after 8 failures while another account is unaffected; behind the proxy setting, one client hits 429 while a different client address still signs in.
- **Remaining limitations:** counters are in memory (reset on restart, not shared across instances). The per-account lock lets an attacker lock a known email out for 15 minutes (new finding N1). `MYO_TRUST_PROXY=1` is only correct with exactly one trusted proxy. Real proxy/tunnel behaviour was not tested.

### S2 — HTTPS deployment depends on opt-in variables · High (operational) · RESOLVED (startup enforcement)
- **Files:** `server.mjs`, `tests/operations.test.mjs`
- **Fix:** with `NODE_ENV=production` the process exits unless `MYO_ORIGIN` is an `https://` origin and `MYO_SECURE_COOKIES=1`. HSTS is sent when secure cookies are enabled.
- **Verification:** startup refusal, `Secure` cookie, HSTS, matching-origin login (200) and foreign-origin rejection (403).
- **Remaining limitations:** the enforcement only applies when `NODE_ENV=production` is set. No real TLS deployment was tested.

### S3 — Photo EXIF/GPS retained · Medium · RESOLVED for new uploads
- **Files:** `lib/image.mjs` (new), `server.mjs` (`photoFrom`), `scripts/scrub-photos.mjs` (new), `tests/image.test.mjs`, `tests/operations.test.mjs`
- **Fix:** the server strips metadata from every JPEG, PNG and WebP before storage. JPEG keeps only an orientation tag so phone photos stay upright. Corrupt images are refused with 400. A dry-run-by-default script scrubs photos already stored.
- **Verification:** unit tests for each format; an upload with a GPS marker is stored without it; the scrub script's dry run changes nothing and `--apply` removes the marker.
- **Remaining limitations:** photos already in a live database stay unscrubbed until someone runs `scripts/scrub-photos.mjs --apply` after a backup (N2). The client still uploads raw JPEGs under 2.5 MB, so the server is the only line of defence. Tested with synthetic images, not real phone photos.

### S4 — Minimal HTTP hardening / malformed URL 500 · Medium · IMPLEMENTED — UNVERIFIED (CSP in browser); malformed URL RESOLVED
- **Files:** `server.mjs`, `tests/api.test.mjs`
- **Fix:** added `Content-Security-Policy` (same-origin scripts and styles, `img-src` self/data/blob, fonts from self and `raw.githubusercontent.com`, no framing or objects), `Permissions-Policy` (camera allowed for self; geolocation, microphone, payment off), and HSTS (see S2). Malformed percent-encoding now returns 404 instead of 500.
- **Verification:** headers and the 404 asserted in tests. I searched the HTML and JS for inline scripts, inline `style` attributes and handlers and found none that the policy would block.
- **Remaining limitations:** the CSP was **not loaded in a browser**. Something the grep missed would show up as a blocked resource in the console. `Permissions-Policy` disables geolocation, so GPS work will need to relax it deliberately.

### S5 — Account lifecycle gaps · Medium · OPEN
Not addressed (email verification, recovery, password change, sign-out-everywhere, staff credential rotation, audit log). Blocked on an email provider decision for the first two.

### D1 — One booking per window · High · IMPLEMENTED — UNVERIFIED (portal UI); API RESOLVED
- **Files:** `server.mjs` (`reserveTime`, `/api/portal`, confirm check), `assets/portal.js`, `tests/api.test.mjs`
- **Fix:** bookings can start at any 30-minute step inside a window (`slotStep`). `/api/bookings` and `/api/reschedule` accept `slot` (window id) plus `start`. `/api/portal` returns `slots` as bookable start times and `windows` for the admin list. Approval checks that a published window still covers the booking.
- **Verification:** a 4-hour window yields 8 starts; two non-overlapping bookings share it; off-grid, before-window, at-window-end and overlapping starts are rejected with 409; two pending requests for one time cannot both be approved; withdrawing the window blocks approval. Old clients that send only `slot` still book the window start.
- **Remaining limitations:** the portal changes (`slotKey`, `payload.start`, `data.windows`) were only syntax-checked, not run in a browser. The 30-minute step is a constant, not a setting. There are no buffers, travel time or multiple staff.

### D2 — Visit lifecycle loose ends · Medium · OPEN
Unchanged. Needs policy decisions (no-show, early-start window, cancellation cutoffs, what rescheduling a Confirmed booking should do).

### D3 — No idempotency on writes · Low–Medium · OPEN (suspected)

### D4 — Ad hoc schema management · Medium · RESOLVED
- **Files:** `server.mjs`, `tests/operations.test.mjs`
- **Fix:** ordered migrations tracked in `PRAGMA user_version` (baseline, `summary` column, then indexes on `events(booking)`, `bookings(owner,starts)`, `booking_pets(pet)`, `pets(owner)`, `sessions(user)`, `slots(starts)`). The server refuses a database from a newer version.
- **Verification:** a legacy database with no version and no `summary` column upgrades to version 3 with its data intact.
- **Remaining limitations:** photos are still BLOBs in the main database (see §4.7). No down-migrations. Query speed improvement was not measured.

### D5 — `/api/portal` returns everything, N×M queries · Medium · IN PROGRESS
The per-slot-per-service query loop is gone; availability is computed in one in-memory pass over active bookings. Pagination, server-side diary filters and photo caching are **not** done.

### O1 — Hosting mismatch in sitemap/robots · Medium · OPEN (depends on the hosting decision)
### O2 — Whole-page re-render loses unsaved input · Low–Medium · OPEN
### O3 — Runtime and tooling · RESOLVED (tests, `engines`); CI IMPLEMENTED — UNVERIFIED
- **Files:** `package.json`, `.github/workflows/test.yml`, `tests/`
- **Fix:** `npm test`, `npm run backup`, `engines.node >= 22.13.0`, and a workflow running syntax checks and tests on Node 22 and 24.
- **Verification:** `npm test` passed locally on Node 22.23.4. The workflow has not run on GitHub; Node 24 was not available here. The `engines` floor is based on my run on 22.23, not on testing 22.13.
- **Remaining limitations:** no linter or type checker. `node:sqlite` still prints an ExperimentalWarning.

### P0-5 — Backups · RESOLVED (tooling); scheduling BLOCKED on hosting
- **Files:** `scripts/backup.mjs`, `package.json`, `tests/operations.test.mjs`
- **Fix:** `npm run backup -- <file>` writes a consistent copy with `VACUUM INTO`, runs an integrity check, and refuses to overwrite.
- **Verification:** a copy of a live database contains the data; a second run to the same path fails.
- **Remaining limitations:** no schedule, no off-machine copy, and restore is a documented manual copy that I did not rehearse end to end.

### P0-6 — Hosting decision · BLOCKED (needs your decision)

### New findings from the remediation
- **N1 — Account lockout can be abused to lock a victim out for 15 minutes.** Medium-low. OPEN. Consider lockout keyed on address + account together, or a CAPTCHA, once email verification exists.
- **N2 — Existing stored photos still carry metadata until the scrub script is run.** Medium. OPEN (operational step after backup).
- **N3 — No browser or device test of the portal after the grid and CSP changes.** High for release. OPEN.

---

## 8. Finding status index

| ID | Finding | Severity | Status |
|---|---|---|---|
| S1 | Shared rate-limit bucket, blocking hashing | High | RESOLVED |
| S2 | HTTPS config not enforced | High | RESOLVED (startup enforcement) |
| S3 | EXIF/GPS retained | Medium | RESOLVED (new uploads); N2 open for old data |
| S4 | Minimal headers, malformed URL 500 | Medium | IMPLEMENTED — UNVERIFIED (CSP in browser) |
| S5 | Account lifecycle (verification, recovery, rotation) | Medium | OPEN |
| D1 | One booking per window | High | IMPLEMENTED — UNVERIFIED (portal UI) |
| D2 | Visit lifecycle loose ends | Medium | OPEN (policy needed) |
| D3 | No write idempotency | Low–Med | OPEN |
| D4 | Ad hoc schema management | Medium | RESOLVED |
| D5 | Unbounded portal payload | Medium | IN PROGRESS |
| O1 | Static hosting mismatch | Medium | OPEN |
| O2 | Re-render loses input | Low–Med | OPEN |
| O3 | No tests/CI/engines | Medium | RESOLVED; CI IMPLEMENTED — UNVERIFIED |
| P0-1 | Automated tests | P0 | RESOLVED (22 tests) |
| P0-5 | Backup tooling | P0 | RESOLVED; scheduling BLOCKED |
| P0-6 | Hosting decision | P0 | BLOCKED |
| P1-3 | Pagination / server-side filters | P1 | OPEN |
| P1-4 | Lifecycle guards | P1 | OPEN |
| P1-5 | Structured pet care profile | P1 | OPEN |
| P1-6 | Email verification and recovery | P1 | OPEN (needs provider) |
| P1-7 | Stripe Checkout | P1 | BLOCKED (needs payment decisions) |
| P1-8 | Sitemap/robots vs hosting | P1 | OPEN |
| P2-* | Edit diary updates, idempotency, i18n, module split, form drafts, staff accounts, new product features | P2 | OPEN |

**Priority changes caused by the fixes:** (1) browser and phone verification of the portal (N3) is now the top item, because the grid and CSP changes touch every customer flow; (2) the hosting decision (P0-6) now gates backup scheduling and the sitemap, so it moves ahead of pagination; (3) the scheduling work no longer blocks Stripe, so payments depend only on business decisions and email.

---

## 9. Remaining Work for Codex (dependency order)

1. **Browser and device verification (N3).** Load the portal with the new CSP in Chrome and Safari; check the console for blocked resources; book on the new grid as customer and staff (book, reschedule, cancel, approve); test camera and library upload on iPhone and Android. Fix whatever breaks. Add a small browser smoke test if practical.
2. **Hosting decision and deployment setup (P0-6, O1, P0-5 scheduling).** Decide Node host vs. Workers/D1. If Node: set `NODE_ENV=production`, `MYO_ORIGIN`, `MYO_SECURE_COOKIES=1`, `MYO_TRUST_PROXY`; schedule `npm run backup` with an off-machine copy and rehearse a restore; fix `sitemap.xml`/`robots.txt`. Run `scripts/scrub-photos.mjs` on any existing database after a backup (N2).
3. **Bounded API responses (D5, P1-3).** Paginate bookings and diary events, add server-side pet/visit filters, and let photos cache privately. Keep the isolation tests passing.
4. **Lifecycle policy and guards (D2, P1-4, D3).** After you decide the rules: no-show state, how early a visit can start, cancellation cutoff, what rescheduling a Confirmed booking does; idempotency keys for bookings and diary events.
5. **Account lifecycle and payments (S5, N1, P1-6, P1-7).** Email provider, verification and recovery, then Stripe Checkout with signed webhooks, a payments table and idempotency. Payments are blocked on the policy decisions listed in the README.
