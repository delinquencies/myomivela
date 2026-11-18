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
- **Schema version** is stored in the `meta` table (`schema_version`, now 12; migrations 5–8 add idempotency, trusted devices, checkout holds, then weekly hours and date exceptions), because Durable Objects forbid `PRAGMA user_version`. Migrations must be safe to re-run. Migration 4 adds `events.photo_key`; the old `photo` BLOB column is no longer read (it only ever held test data).
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

### Engineering and verification
- **First Cloudflare deploy:** never done. It needs the R2 bucket, secrets and a check on the `workers.dev` URL. Use **Workers Paid**: scrypt uses about 40 ms CPU per sign-in, over the Free plan's 10 ms limit.
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
