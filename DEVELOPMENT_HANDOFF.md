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
- **Schema version** is stored in the `meta` table (`schema_version`, now 8; migrations 5–8 add idempotency, trusted devices, checkout holds, then weekly hours and date exceptions), because Durable Objects forbid `PRAGMA user_version`. Migrations must be safe to re-run. Migration 4 adds `events.photo_key`; the old `photo` BLOB column is no longer read (it only ever held test data).
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

**Booking holds and weekly hours.** `POST /api/checkout-hold` creates a short hold and `POST /api/checkout-release` releases it. The request flow checks the hold and current availability when submitting. Staff set recurring hours with `POST /api/schedule` and individual-date changes with `POST /api/schedule-exception`.

**Configuration.** Cloudflare needs only the `MYO_ADMIN_EMAIL` and `MYO_ADMIN_PASSWORD` secrets. The Node-only variables (`MYO_DB`, `NODE_ENV`, `MYO_ORIGIN`, `MYO_SECURE_COOKIES`, `MYO_TRUST_PROXY`) are listed in the README.

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

## 5. Open findings and blockers

Open release work includes visit-start and cancellation rules, required care information, email verification and recovery, outbound confirmations, payment, Spanish in the portal, and production domain and sitemap updates. Visits can start from the visit buffer (default 30 minutes) before their booked time, enforced by `POST /api/status` and shown in the staff portal; `MYO_EARLY_START_MINUTES` overrides it (tests lift it). Payments depend on the provider and payment policy decisions.

- **First deploy needs a human check:** R2 bucket creation, secrets, the `workers.dev` URL, then a custom domain. See README.
- **Plan:** password hashing (scrypt, about 40 ms CPU per sign-in) exceeds the Workers Free plan's 10 ms CPU limit. Use Workers Paid.
- **Backups:** manual "Download backup" plus 30 days of Durable Object point-in-time recovery for the database. Nothing schedules downloads or copies them off-account yet, and a restore has only been rehearsed in tests, not on a deployed site.
- **Decisions needed from the owner:** the public domain (then fix `sitemap.xml`/`robots.txt`, O1/P1-8), payment timing and refunds, cancellation and no-show policy, an email provider.

## 6. Recommended next tasks

1. **First Cloudflare deploy and smoke check.** Follow the README steps, then sign in as staff and as a customer on the `workers.dev` URL and run one visit with a photo. Add the custom domain and fix `sitemap.xml`/`robots.txt`.
2. **Safari and phone verification (N3 remainder).** Safari on macOS and iOS, Android Chrome, camera capture and iPhone HEIC photos.
3. **Scheduled off-account backups.** Backup download and restore exist. Still to do: a schedule (a Cron Trigger writing the same archive to a second bucket or an off-Cloudflare store, once one is chosen) and a restore rehearsal on the real deployment.
4. **Lifecycle rules (D2, P1-4)** once the owner decides the policy.
5. **Accounts, email and payments (S5, N1, P1-6, P1-7).** Email provider, verification and recovery; then Stripe Checkout with signed webhooks (a new `public` route that verifies the signature), a payments table and idempotent handling.


## 7. Usability and UX test for Claude

**Done 2026-11-18:** see [docs/audits/2026-11-18-usability-test.md](docs/audits/2026-11-18-usability-test.md). Its H1 (early start), H2 (hold expiry) and M1 (abandoned holds) are fixed, with `tests/early-start.test.mjs` and `tests/browser/holds-smoke.mjs`. Physical devices, Safari, Firefox and screen readers were not available and remain to be tested.

Claude, run a fresh customer and staff usability pass against the latest `main` with fictional data and separate authenticated sessions. Use [the previous friction log](docs/audits/myo-live-ux-friction-log.md) as a retest list, then compare notes with the current build.

1. **First-time customer journey.** Start on the homepage in English and Spanish. Open a service, find the price and available times, register, add a pet, review the hold, edit and resume, submit the request, and find its status. Exercise no availability, a missing pet, expiry, rescheduling, and cancellation. Verify that the UI distinguishes a hold, a request, a confirmed visit, and payment availability.
2. **One-handed staff journey.** Set weekly hours, a buffer, and a date exception. Find the request, approve it, start the visit, take or choose a photo, publish it, and complete the visit. Check whether actions and feedback stay within thumb reach, the software keyboard or floating controls obscure anything, and returning to the diary preserves an unsent draft. Retest the known future-visit start behavior and report its impact.
3. **Customer diary and accessibility.** Confirm that the customer can find the completed visit and refresh, filter, and open the photo. Verify another customer cannot open it. Check keyboard focus, accessible names and announcements, text zoom, reduced motion, swipe versus vertical scroll, and the sticky menu in a short landscape viewport.
4. **Device coverage.** Use Chromium for a reproducible pass at 320 and 390 CSS pixels, plus desktop. If available, use real iPhone Safari and Android Chrome for one-handed navigation, the camera and photo library, rotation, and HEIC behavior. Record emulated and physical-device results separately.

Leave a dated report under `docs/audits/` with the commit, runtime, browsers and devices, what passed, and findings ranked by severity. For each finding include the user impact, steps to reproduce, expected and actual behavior, and a screenshot or recording when useful. Separate confirmed bugs from policy decisions and items you could not test.
