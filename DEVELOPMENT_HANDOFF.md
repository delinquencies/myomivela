# Development handoff for Codex

Updated 2026-11-17 on branch `audit-remediation` (based on `6aad46d`). Finding IDs refer to [MYO_AUDIT.md](MYO_AUDIT.md); the status of each is in its §8 index and the detail in §7. Everything below is committed and pushed. **Nothing has been deployed to Cloudflare yet.**

## 1. Where things stand

- **Hosting is decided: Cloudflare.** One Worker serves the site and portal as static assets and forwards `/api/` to a single Durable Object (`MyoApi`) that owns the SQLite database. Photos are in R2. The same app also runs on Node for local development and the fast tests. Deploy steps are in the README ("Deploy to Cloudflare").
- Security hardening, migrations, the 30-minute booking grid, paged history and diary, and the module split are done and tested on both runtimes.
- The portal passes an end-to-end browser run in Chromium on both runtimes. Safari and real phones are untested.

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
- **Schema version** is stored in the `meta` table (`schema_version`, now 4), because Durable Objects forbid `PRAGMA user_version`. Migrations must be safe to re-run. Migration 4 adds `events.photo_key`; the old `photo` BLOB column is no longer read (it only ever held test data).
- **Rate limits** are in memory. On Cloudflare they live in the single Durable Object, keyed by `CF-Connecting-IP`.

## 3. API reference (changes since `6aad46d`)

- `POST /api/bookings` and `POST /api/reschedule` accept an optional `start` (epoch ms) alongside `slot` (window id): inside the window, on a 30-minute step, in the future, conflict-free. Without `start` the window start is used.
- `GET /api/portal` returns `slots` as bookable start times (`{ id: windowId, starts, ends: windowEnd, service_ids }`) and `windows` (raw published windows). It no longer returns `events`. `bookings` holds upcoming and in-progress bookings plus the newest 20 past ones; `history_next` is the cursor for the rest. For staff, `pets` holds only the pets those bookings reference.
- `GET /api/history?before=<cursor>` → `{ bookings, pets, next }`, 20 per page, newest first.
- `GET /api/diary?pet=&visit=&before=<cursor>` → `{ visits, events, pets, next }`, 10 visits per page with all their updates. Cursors are `<starts>.<id>`; `next` is `null` on the last page.
- `GET /api/photos/<id>` streams from R2 (or the local photos folder) with `Cache-Control: private, max-age=3600`.
- Sign-in/register: 429 after 30 requests per minute per address; sign-in 429 after 8 failures per account in 15 minutes. Malformed URLs return 404. Uploaded photos are re-written without metadata; a corrupt image returns 400.

**Configuration.** Cloudflare needs only the `MYO_ADMIN_EMAIL` and `MYO_ADMIN_PASSWORD` secrets. The Node-only variables (`MYO_DB`, `NODE_ENV`, `MYO_ORIGIN`, `MYO_SECURE_COOKIES`, `MYO_TRUST_PROXY`) are listed in the README.

## 4. Tests

| Command | Runs | Result (Node v22.23.4, wrangler 4.164.0) |
|---|---|---|
| `npm test` | all suites on Node | 32 passed |
| `npm run test:worker` | the same suites under `wrangler dev` (Durable Object SQLite, local R2, static assets) | 24 passed, 8 skipped (Node-only: direct database seeding, backup script, legacy upgrade, Node production checks) |
| `npm run test:browser` | Chromium, phone viewport, full customer and staff flow; fails on any console or CSP error | clean on Node |
| `MYO_TARGET=worker npm run test:browser` | the same on the Worker | clean (the database-seeded paging step is skipped) |
| `npx wrangler deploy --dry-run` | production bundle | 40 KB, no Node-only modules |

CI runs `npm test` on Node 22 and 24 and `npm run test:worker`. The workflow has not been observed running on GitHub yet.

**Not run:** a real Cloudflare deployment, Safari/WebKit, Firefox, real phones and their camera and HEIC photos.

## 5. Open findings and blockers

OPEN: S5, D2, D3, O1, O2, P1-4, P1-5, P1-6, P2 items, N1. RESOLVED: S1–S3, D1, D4, D5, P0-1, P0-6, P1-3, P2-4; N2 is moot (photos are no longer stored in the database). BLOCKED: P1-7 (Stripe, needs payment decisions). See MYO_AUDIT.md §8.

- **First deploy needs a human check:** R2 bucket creation, secrets, the `workers.dev` URL, then a custom domain. See README.
- **Plan:** password hashing (scrypt, about 40 ms CPU per sign-in) exceeds the Workers Free plan's 10 ms CPU limit. Use Workers Paid.
- **Backups on Cloudflare:** Durable Object point-in-time recovery covers 30 days. R2 photos have no backup or export yet.
- **Decisions needed from the owner:** the public domain (then fix `sitemap.xml`/`robots.txt`, O1/P1-8), payment timing and refunds, cancellation and no-show policy, an email provider.
- Account lockout can be used to lock a known email out for 15 minutes (N1).

## 6. Recommended next tasks

1. **First Cloudflare deploy and smoke check.** Follow the README steps, then sign in as staff and as a customer on the `workers.dev` URL and run one visit with a photo. Add the custom domain and fix `sitemap.xml`/`robots.txt`.
2. **Safari and phone verification (N3 remainder).** Safari on macOS and iOS, Android Chrome, camera capture and iPhone HEIC photos.
3. **Data export and R2 backup.** A staff-only export (or a scheduled Worker) that copies the database and R2 photos somewhere off-account, and a rehearsed restore.
4. **Lifecycle rules and idempotency (D2, P1-4, D3, O2)** once the owner decides the policy.
5. **Accounts, email and payments (S5, N1, P1-6, P1-7).** Email provider, verification and recovery; then Stripe Checkout with signed webhooks (a new `public` route that verifies the signature), a payments table and idempotent handling.
