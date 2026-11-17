# Development handoff for Codex

Written 2026-11-17 on branch `audit-remediation` (based on `6aad46d`). Finding IDs refer to [MYO_AUDIT.md](MYO_AUDIT.md); the status of each is in its §8 index and the detail in §7. Nothing here was committed or deployed. The changes are working-tree edits for you to review and commit.

## 1. What Claude implemented

Security, reliability, scheduling and test coverage from the audit. No redesign or restyling.

- Proxy-aware per-address rate limiting, a per-account failed-login limit, and non-blocking (async) password hashing.
- Production start-up checks (HTTPS origin and secure cookies), HSTS, CSP, Permissions-Policy, and 404 instead of 500 for malformed URLs.
- Server-side stripping of photo metadata (EXIF/GPS/XMP/text) for JPEG, PNG and WebP, and a script to scrub photos stored earlier.
- Ordered database migrations with `PRAGMA user_version`, plus indexes.
- A verified SQLite backup script.
- A 30-minute bookable start-time grid inside published windows.
- 22 automated tests and a GitHub Actions workflow.
- README, audit and this handoff updated.

## 2. Audit findings resolved

| ID | Status |
|---|---|
| S1 rate limiting / blocking hashing | RESOLVED |
| S2 HTTPS config enforcement | RESOLVED (start-up enforcement only) |
| S3 EXIF/GPS in photos | RESOLVED for new uploads (old data: N2) |
| D4 ad hoc schema | RESOLVED |
| P0-1 tests | RESOLVED |
| P0-5 backup tooling | RESOLVED (scheduling BLOCKED) |
| O3 tooling | RESOLVED; CI IMPLEMENTED — UNVERIFIED |
| S4 headers/CSP | IMPLEMENTED — UNVERIFIED (CSP never loaded in a browser); malformed-URL fix RESOLVED |
| D1 one booking per window | IMPLEMENTED — UNVERIFIED (API tested; portal UI not run) |
| D5 portal payload | RESOLVED (paged history and diary, private photo caching) |

## 3. Files and systems modified

- `server.mjs` was split into `lib/` modules (see the README layout): migrations in `lib/db.mjs`, scrypt, sessions and rate limiting in `lib/auth.mjs`, production checks in `lib/config.mjs`, CSP and headers in `lib/static.mjs`, the start-time grid in `lib/scheduling.mjs`, metadata stripping in `lib/photos.mjs`. To add an endpoint, add an entry with `method`, `path`, `access` and `handler` to a file in `lib/routes/`; `tests/routes.test.mjs` checks its access rule automatically. Keep `transaction()` callbacks synchronous (it throws if given an async one).
- `assets/portal.js`: `slotKey`, sends `start` with `slot`, admin window list reads `data.windows`. Nine changed lines.
- `lib/image.mjs`, `scripts/backup.mjs`, `scripts/scrub-photos.mjs`: new.
- `tests/` (`helpers.mjs`, `api.test.mjs`, `image.test.mjs`, `operations.test.mjs`): new.
- `.github/workflows/test.yml`: new.
- `package.json`: `test` and `backup` scripts, `engines`.
- `README.md` (rewritten to match reality), `MYO_AUDIT.md` (original kept, remediation added), `docs/handoff.md` (pointer added).

## 4. Database and API changes

**Database.** Schema version is now 3 via `PRAGMA user_version`. Migrations 1–2 are the old baseline and `summary` column. Migration 3 adds indexes only; no column or data changes. An old database upgrades in place on first start (tested). To change the schema, append a migration; never edit an existing one.

**API.**
- `POST /api/bookings` and `POST /api/reschedule` accept an optional `start` (epoch ms) alongside `slot` (window id). It must be inside the window, on a 30-minute step from the window start, in the future, and free of conflicts. Without `start` the window start is used, as before.
- `GET /api/portal` now returns `slots` as individual bookable start times (`{ id: windowId, starts, ends: windowEnd, service_ids }`) and a new `windows` array with the raw published windows. Anything that read `slots` as windows (the admin list) must read `windows`.
- `GET /api/portal` no longer returns `events`. `bookings` holds upcoming and in-progress bookings plus the newest 20 past ones, and `history_next` is the cursor for the rest. For staff, `pets` holds only the pets those bookings reference.
- `GET /api/history?before=<cursor>` → `{ bookings, pets, next }`, 20 past bookings per page, newest first.
- `GET /api/diary?pet=&visit=&before=<cursor>` → `{ visits, events, pets, next }`, 10 visits per page with all their updates. Cursors are `<starts>.<id>`; `next` is `null` on the last page.
- Sign-in and register: 429 after 30 requests per minute per address; sign-in 429 after 8 failures per account in 15 minutes.
- Photo uploads are re-written without metadata; a corrupt image returns 400.
- Malformed URLs return 404.

**Configuration.** New variable `MYO_TRUST_PROXY` (`1` or `cloudflare`). `NODE_ENV=production` now requires `MYO_ORIGIN` (https) and `MYO_SECURE_COOKIES=1` or the server exits.

## 5. Tests executed and results

- `npm test` (32 tests): **32 passed, 0 failed** on Node v22.23.4. Covers the booking lifecycle, cross-customer isolation, the grid (overlap, off-grid, boundaries), double approval, withdrawn windows, price mismatch, headers, malformed URLs, account lockout, proxy-aware limiting, production configuration, image stripping for each format, a legacy-database upgrade, backup, and photo scrubbing.
- Regression check: with metadata stripping disabled, the photo test failed; with the per-address limit disabled, the proxy test failed.
- `node --check` on all changed JavaScript passed.
- **Not run:** Node 24; the GitHub Actions workflow; any browser or phone; real phone photos; any deployment. No linter or type checker exists in the repo.

## 6. Remaining audit findings

OPEN: S5, D2, D3, O1, O2, P1-4, P1-5, P1-6, P1-8, P2 items. RESOLVED since: D5, P1-3. BLOCKED: P0-6 (hosting decision), P1-7 (Stripe, needs payment decisions), backup scheduling. New: N1 (account lockout can be abused), N2 (old photos unscrubbed), N3 (Chromium covered by `npm run test:browser`; Safari and devices untested). See MYO_AUDIT.md §8.

## 7. Known bugs and blockers

- **Unverified UI:** the portal was not exercised after the grid and CSP changes. If the page fails to load or shows blocked resources, check the browser console first; the CSP is in `lib/static.mjs` (`contentSecurityPolicy`).
- **Decisions needed from the owner:** hosting (Node host vs. Workers/D1), payment timing and refund rules, cancellation and no-show policy, email provider.
- Rate-limit state is in memory only.
- Account lockout is a denial-of-service lever for a known email (N1).
- Existing stored photos keep their metadata until `node scripts/scrub-photos.mjs --apply` is run on a backed-up database (N2).

## 8. Partially completed work

- **D5:** resolved. Upcoming bookings are still unpaged (bounded by the schedule), and the diary's visit filter lists only the pages loaded so far.
- **D1:** the 30-minute step is a constant. There is no buffer, travel time or multi-staff concept.
- **S4:** headers are set, but the CSP is unproven in a browser.

## 9. Recommended next five Codex tasks

1. **Safari and phone verification (N3 remainder).** Chromium passes `npm run test:browser` (the full customer and staff flow, with no CSP violations). Still to check by hand: Safari on macOS and iOS, Android Chrome, camera capture and iPhone HEIC photos.
2. **Hosting and operations (P0-6, O1, backups, N2).** Pick the host (a Node host with a persistent disk is the shortest path), set the production variables, schedule `npm run backup` with an off-machine copy and rehearse a restore, run the photo scrub after a backup, and fix `sitemap.xml` and `robots.txt`.
3. ~~Bounded responses (D5, P1-3).~~ Done: `/api/history`, `/api/diary`, private photo caching, `tests/pagination.test.mjs`.
4. **Lifecycle rules and idempotency (D2, P1-4, D3, O2).** Once the owner decides the policy: no-show, early-start limit, cancellation cutoff, rescheduling a Confirmed booking, idempotency keys, and preserving unsaved form input.
5. **Accounts, email and payments (S5, N1, P1-6, P1-7).** Add an email provider, verification and recovery; then Stripe Checkout with signed webhooks, a payments table and idempotent handling, gating "Start visit" per the agreed policy.
