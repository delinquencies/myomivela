# myomivela

myo. is Myomi’s pet-care website and portal. Customers request visits and read a private Pet Diary. Staff publish availability, approve requests, run visits and post updates with photos.

## Status at a glance

- **Implemented:** launch pricing, booking review with a temporary hold, request, approval, visit, diary update and completion summary; care intake, agreements, vaccine records and encrypted home-access details; owner and sitter staff roles; daily scheduled backups. See [What works today](#what-works-today).
- **Built but switched off or waiting for screens:** the 50% deposit and launch cancellation terms (server rules done; the review and payment screens are Codex's next tasks); online payment (Stripe, off until configured); the notification outbox and password recovery (no email provider yet); recurring visits, fee rules and packages (APIs, minimal UI); the guest quote, ZIP check, visit page, confirmation next steps and self-refreshing diary (APIs and modules ready; Codex is building the screens).
- **Not implemented:** invoices or receipts, care checklists, GPS walk tracking, messaging and email verification. See [Not built yet](#not-built-yet).
- **Not production-ready for public launch.** Read [Known limitations](#known-limitations) and the [audit](MYO_AUDIT.md) first.

## Technology and structure

**Cloudflare is the production target.** One Worker serves the public site and portal as static assets and forwards `/api/` to a single Durable Object, which holds the SQLite database. Photos are stored in R2. The same app code also runs on Node.js (22.13 or newer) for local development and the fast test suite, with `node:sqlite` and photos on disk. Both runtimes share everything in `lib/`; only `worker.mjs` and `server.mjs` differ. There are **no runtime dependencies** (Wrangler is a dev dependency). The front end is plain HTML, CSS and ES modules.

```
worker.mjs            Cloudflare entry: static assets, security headers, the MyoApi Durable Object and its alarm
wrangler.jsonc        Cloudflare config: assets, Durable Object, R2 buckets (myo-photos, myo-backups)
server.mjs            Node entry (local dev and tests): bridges node:http to the same app, runs the outbox and backup timers
lib/config.mjs        Every environment variable, and the production checks
lib/db.mjs            Ordered migrations, query helpers, transaction(), photo and backup storage (runtime-neutral)
lib/stores/           Storage adapters: node.mjs (node:sqlite + files), durable.mjs (Durable Object SQLite + R2)
lib/api.mjs           Route table and access rules (public / user / staff / owner), origin check
lib/routes/           Handlers: account (incl. contact and recovery), public (ZIP check, guest quote), portal, bookings,
                      diary, intake, compliance, care, access, clients, payments, fees, packages, series, outbox,
                      staff, admin
lib/auth.mjs          Password hashing, sessions and cookies, roles, admin bootstrap, rate limiting
lib/validate.mjs      Input checks (requireThat, field, integer, email) and body reading
lib/headers.mjs       Security headers (CSP etc.), JSON errors, URL decoding
lib/domain.mjs        Service catalog, activity types, report fields, status transitions
lib/scheduling.mjs    Windows, bookable start times, stays, overlap checks
lib/capacity.mjs, availability.mjs  Daily capacity, and day-by-day availability labels
lib/pricing.mjs, fees.mjs, quote-terms.mjs  Launch and catalog pricing, fee rules, deposit/notice/peak terms on quotes
lib/service-area.mjs  15-mile ZIP table around Springfield (generated data, source and date in the file)
lib/bookings.mjs      Access-checked booking queries and page cursors
lib/compliance.mjs, care.mjs, vault.mjs  Booking requirements, care records, AES-GCM vault for entry details
lib/ledger.mjs, payments.mjs, cancellation.mjs, packages.mjs, series.mjs  Money, Stripe, cancellation terms, packages, recurring visits
lib/outbox.mjs        Notification templates (EN/ES) and the sending queue
lib/idempotency.mjs   Safe retries: a write repeated with the same Idempotency-Key runs once
lib/backup.mjs, scheduled-backup.mjs  Whole-installation backup and restore; the daily scheduled copy
lib/photos.mjs, image.mjs  Upload validation; EXIF/XMP/text metadata stripping
lib/site.mjs          Which files are public; used by the Node static server and the Cloudflare build
lib/static.mjs        Node only: serves the public files
assets/portal.js      Customer and staff portal (renders into portal/index.html); care-portal.js adds care features
assets/myo-config.js  Launch rates, policies, peak dates, intake fields: the single source for prices and policy copy
assets/portal-route-state.js, booking flow data: intake-model.js, visit-state.js, diary-sync.js  Pure modules (no DOM)
assets/drafts.js      Keeps unsaved form input across re-renders and tab reloads, by sensitivity (see below)
assets/diary.js, diary-sample.js  Diary rendering shared by the portal and the public sample
assets/i18n.js, ui-copy.js, care-copy.js, myo-copy.js, policy-copy.js, public-i18n.js  English/Spanish copy
assets/home.js, myo-launch.js, price-sheet.js  Public site: header animation, service cards, rates page, price sheet
assets/*.css          Checked-in styles (no build step)
index.html, myo/      Public homepage, About, FAQ, Rates & Policies (myo/launch), sample diary
portal/index.html     Portal shell
scripts/build-site.mjs  Copies the public files into dist/site for Cloudflare (run automatically by wrangler)
scripts/restore.mjs   Restores a downloaded backup into a new installation over the API (any runtime)
scripts/backup.mjs    Consistent, verified copy of the local Node database file
scripts/test-worker.mjs  Runs the test suites against wrangler dev (used by npm run test:worker)
tests/                node:test suites (API, rules, pure modules); tests/browser/ Playwright smoke tests
.github/workflows/    CI: syntax check and `npm test` on Node 22 and 24, and `npm run test:worker`
docs/                 Audits, UX flow audit, Claude/Codex plans, earlier notes, archived design previews
MYO_AUDIT.md          Earlier audit with remediation log
DEVELOPMENT_HANDOFF.md  Engineering status, API reference and open work
```

## Current launch iteration

The approved launch rates in `assets/myo-config.js` now price live server quotes, holds, requests and reviewed reschedules by default. The public calculator and generated service agreements use the same configuration. `MYO_PRICING_MODE=catalog` explicitly retains staff-defined catalog pricing for existing installations and compatibility fixtures. Existing booking totals are retained until a reviewed reschedule.

Customers use **Care details** to save all required intake and emergency information, accept the current agreement and save encrypted home-entry instructions. Care details opens from **My pets**. Pet cards offer vaccine records with PDF/image uploads and a care timeline. Staff can configure vaccine requirements, publish bilingual agreement versions, reveal entry details within the visit window, publish structured activity answers, and manage private client or pet notes. Overnight bookings have a two-month date picker and a diary grouped by night.

In launch mode, a client's first paid booking needs a complete care intake and a completed complimentary Meet & Greet; one Meet & Greet covers every later booking, and it must be booked at least 24 hours ahead. A paid request owes a 50% deposit within 48 hours of being sent, and Myomi confirms it once the deposit is in. With online payment on, an unpaid request is released at its deadline; with it off, Myomi records deposits by hand and decides. Cancelling 7 or more days ahead is free; later, Myomi keeps 50% of the deposit paid. The ten-visit daily limit is checked on quotes, holds and confirmation, and full days are no longer offered as times or nights. Short notice uses Massachusetts calendar days and adds the configured fee. The first pet in a quote's list is priced as the primary pet.

Main also includes Stripe Checkout, payment/refund records, recurring and package APIs, staff roles, scheduled backups and password recovery. Live payment credentials and an email driver remain unconfigured. See the [iteration report](docs/audits/2026-11-18-launch-iteration.md) and the [Claude UX plan](docs/plans/claude-ux-plan.md) for verified work and open dependencies.

## Run locally

```sh
npm start      # Node, at http://127.0.0.1:45838/
npm run dev    # the Cloudflare runtime locally (wrangler dev), at http://127.0.0.1:8787/
```

Open <http://127.0.0.1:45838/>. Use separate browser profiles or a private window for the [client portal](http://127.0.0.1:45838/portal/) and the [staff sign-in](http://127.0.0.1:45838/portal/?staff=1#diary), because they use different sessions.

### Environment variables

Names only; set them in the shell (Node), as `--var` flags or a git-ignored `.dev.vars` file (`npm run dev`), or as Cloudflare secrets (production). Never commit values. On Cloudflare only `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` and `MYO_VAULT_KEY` are needed (plus the Stripe settings to turn on online payment): the Worker sees the real https URL and Cloudflare's `CF-Connecting-IP`, so the origin, cookie and proxy settings are automatic.

| Variable | Purpose |
| --- | --- |
| `MYO_DB` | Node only. SQLite file path. Default `.myo/data.sqlite` (ignored by git); photos go in a `photos` folder next to it. |
| `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` | Creates the staff account at startup if that email does not exist (password 12–128 characters). Changing the password variable later does **not** change an existing account; change it in the portal under **Account** instead. |
| `PORT`, `HOST` | Listener. Defaults `45838` and `127.0.0.1`. |
| `NODE_ENV` | Node only. `production` makes the server refuse to start unless `MYO_ORIGIN` is an `https://` origin, `MYO_SECURE_COOKIES=1` and `MYO_VAULT_KEY` is set, and it refuses the test-only `MYO_PAYMENTS=fake` and `MYO_EMAIL=log`, and `MYO_PAYMENTS=stripe` without both Stripe secrets. The Worker checks the last four itself: while any is wrong it answers every API call except `GET /api/session` with 503 `not_configured`, sends no email, and lists the problems in its log (`wrangler tail`). |
| `MYO_TEST_SETTINGS` | Tests only (the test harness sets it). `1` lets a Worker run with `MYO_PAYMENTS=fake`, `MYO_EMAIL=log` or no vault key. Never set it on a real deployment. |
| `MYO_PRICING_MODE` | Optional. Unset: **launch** pricing from `assets/myo-config.js`, with the launch booking rules (intake and Meet & Greet requirements, daily capacity). `catalog`: staff-set prices per service and the earlier rules, for existing installations and most test fixtures. |
| `MYO_ORIGIN` | Exact public origin (for example `https://example.com`). Browser POSTs with a different `Origin` are rejected. Without it the server expects `http://<host>`. |
| `MYO_SECURE_COOKIES` | `1` adds `Secure` to the session cookie and sends HSTS. Required in production. |
| `MYO_VAULT_KEY` | Required in production (Node refuses to start without it; the Worker refuses the API). Base64 of 32 random bytes, for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Encrypts customers' entry instructions. Keep it with your backups: a restored database needs the same key. To rotate, move the old value to `MYO_VAULT_KEY_PREVIOUS` and set a new one; records are re-encrypted as they're read. It also seals password-reset links while they wait to be emailed. |
| `MYO_PAYMENTS` | Optional. `stripe` turns on online payment through Stripe Checkout (needs the two Stripe settings below). Unset: staff record payments by hand. `fake` is for tests and is refused in production. |
| `MYO_STRIPE_SECRET_KEY` | With `MYO_PAYMENTS=stripe`. A restricted key that can create Checkout Sessions and Refunds. Secret. |
| `MYO_STRIPE_WEBHOOK_SECRET` | With `MYO_PAYMENTS=stripe`. The signing secret of a Stripe webhook endpoint at `/api/payments/webhook`, sending `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `refund.created`/`refund.updated`. Secret. |
| `MYO_EMAIL` | Optional. No email provider is connected yet, so messages wait in the outbox (owner: `GET /api/outbox`) and password recovery reports itself unavailable. `log` marks them sent without sending (tests only; refused in production). |
| `MYO_BACKUP_DIR` | Node only, optional. A directory for the daily scheduled backup (use another disk or a synced folder). Unset: no scheduled backups on Node. Cloudflare uses the `myo-backups` bucket instead. |
| `MYO_BACKUP_KEEP` | Optional. How many scheduled backups to keep (default 30). |
| `MYO_EARLY_START_MINUTES` | Optional. Minutes before its booked time that staff may start a visit. Unset: the visit buffer from **Services & availability** (default 30). The tests set a large value. |
| `MYO_TRUST_PROXY` | Node only (the Worker always uses `CF-Connecting-IP`). `1` takes the client address from the last `X-Forwarded-For` entry; `cloudflare` uses `CF-Connecting-IP`. Set only when exactly one trusted proxy sits in front, otherwise leave unset. Used for rate limiting. |

### Create a test staff account

```sh
export MYO_ADMIN_EMAIL='staff@example.test'
export MYO_ADMIN_PASSWORD='replace-with-a-unique-test-password'
export MYO_DB='.myo/preview.sqlite'
npm start
```

On PowerShell use `$env:NAME = 'value'`. Use fictional customers and a separate database for testing.

### Try a booking and diary update

The default launch mode follows the real launch rules, so a first paid visit takes a few more steps. For a quick look, start with `MYO_PRICING_MODE=catalog` and skip steps 3–4.

1. Sign in as staff. Under **Services & availability**, add the services (in launch mode their prices come from `assets/myo-config.js`) and save weekly hours or publish a future appointment window. Customers can book any 30-minute start inside a window long enough for the service. Staff enter windows in their device’s time zone; the portal displays Massachusetts time.
2. In another profile, register as a customer, add a pet, and complete **Care details** (the care intake).
3. Request a free **Meet & Greet**. As staff, approve it, start it and complete it.
4. As the customer, request the paid visit, review it and send it.
5. As staff, approve the request, start the visit, publish a diary update with a photo, then complete the visit with a summary.
6. As the customer, open **Pet Diary**. A second customer must not be able to open the update or its photo.
7. Still open: run this on real iPhone and Android devices, including the camera and photo-library buttons.

## Deploy to Cloudflare

One-time setup, from a machine logged in to the Cloudflare account. Sign-in hashes passwords with scrypt, which uses about 40 ms of CPU per sign-in, more than the Workers Free plan's 10 ms per request. Plan on **Workers Paid**.

```sh
npm ci
npx wrangler login
npx wrangler r2 bucket create myo-photos
npx wrangler r2 bucket create myo-backups
npx wrangler secret put MYO_ADMIN_EMAIL
npx wrangler secret put MYO_ADMIN_PASSWORD
```

```sh
npx wrangler secret put MYO_VAULT_KEY
npm run deploy
```

To turn on online payment later, add `MYO_PAYMENTS=stripe` as a variable and `MYO_STRIPE_SECRET_KEY` and `MYO_STRIPE_WEBHOOK_SECRET` as secrets, then point a Stripe webhook at `https://<your-site>/api/payments/webhook`.

`npm run deploy` copies the public files into `dist/site`, bundles `worker.mjs` and uploads both. The first deploy creates the `MyoApi` Durable Object and its database, and the staff account is created on the first API request. The site is then live at `myo.<your-subdomain>.workers.dev`. To serve it on your own domain, add it under the Worker's **Settings → Domains & Routes** in the Cloudflare dashboard. Every later change ships with `npm run deploy`.

## Database and migrations

SQLite in both runtimes: the Durable Object's built-in SQLite on Cloudflare, `node:sqlite` locally. The schema is created and upgraded automatically on start by the ordered `migrations` list in `lib/db.mjs`. The applied count is stored in the `meta` table (`schema_version`, currently 30), because Durable Objects do not allow `PRAGMA user_version`. To change the schema, **append** a migration that is safe to re-run. Never edit an earlier one. Photos are not in the database: they are stored in R2 (Cloudflare) or files (Node) under the event's `photo_key`.

### Backups and restore

**Download backup** (owner, **Services & availability**, or `GET /api/backup`) saves the whole installation as one `myo-backup-<date>.json.gz` file. It includes accounts, pets, services, windows, bookings, diary updates and every photo, and works the same on Cloudflare and Node. All tables are read in one consistent pass. Sessions are not included. **The file contains password hashes and customers' personal details: store it privately**, for example in an encrypted drive, never in the repository or a shared folder. **Scheduled backups** write the same file once a day, keeping the newest 30 (`MYO_BACKUP_KEEP`): to the `myo-backups` R2 bucket on Cloudflare, and to `MYO_BACKUP_DIR` on Node when it is set. Settings shows when the last one was made; the owner can download any of them (`GET /api/backups`) for a restore.

To restore, deploy or start a **new, empty** installation, then run:

```sh
MYO_STAFF_EMAIL='staff@…' MYO_STAFF_PASSWORD='…' node scripts/restore.mjs myo-backup-2026-11-17.json.gz https://your-site
```

Use the staff account of the new installation (its `MYO_ADMIN_*` settings). Photos are uploaded first, then all tables are replaced in one transaction. The server refuses if the installation already has customers, pets, bookings or diary updates, so a restore can never overwrite live data. The backup must come from the same schema version. Afterwards everyone is signed out and signs in with the accounts from the backup.

Also available:

- **Cloudflare:** Durable Object SQLite keeps 30 days of point-in-time recovery for the database (not the R2 photos), restorable through Cloudflare's Durable Object API.
- **Node (local):** `npm run backup -- backups/myo-$(date +%F).sqlite` copies the raw database file. Copy the `photos` folder too.

## Tests and builds

```sh
npm test             # Node API and integration tests with temporary databases
npm run test:worker  # the same suites against the Cloudflare runtime (wrangler dev); Node-only tests are skipped
npm run test:browser # Playwright/Chromium smoke tests (portal, holds, booking form, Meet & Greet, accessibility,
                     # bilingual pages, care, payments, staff roles, navigation); MYO_TARGET=worker runs them on the Worker
npm run build  # only rebuilds the archived design-preview stylesheet (needs `npm ci`); the live site has no build
```

Playwright is not a dev dependency: install it separately (`npm install --no-save playwright`, then `npx playwright install chromium`). Most browser tests also fall back to a global install; `tests/browser/care-smoke.mjs` imports it directly. There is no linter or type-check script; some modules carry `// @ts-check` for editor checking. CI (`.github/workflows/test.yml`) runs a syntax check and `npm test` on Node 22 and 24, and `npm run test:worker`; it does not run the browser tests.

## What works today

- **Public site:** bilingual (English/Spanish) homepage, About Myomi, FAQ, Rates & Policies (launch rates, peak dates, policies and an estimate calculator) and a sample Pet Diary, with one shared header and menu. Service cards link to booking.
- **Accounts:** customer registration, sign-in and sign-out with scrypt password hashes and hashed server-side sessions. Under **Account**, anyone can change their password (other devices are signed out) or sign out everywhere. Failed sign-ins lock out the guessing address, never the owner's devices (see below). Customers can add a phone, home address and ZIP. Password recovery by email is built and reports itself unavailable until an email provider is connected.
- **Portal menus:** clients see **Home** (care in progress, latest update, next booking, one "Book a visit"), **My bookings** and **My pets** (with **Care details** and each pet's diary), plus **Account**. Staff see **Today** (visit in progress, today's visits, requests to decide, money to settle), **Bookings**, **Clients** and **More** (settings groups, financials, booking history, publishing). A visit opens its own page with the care plan, the update form, what's been logged and the completion step.
- **Staff roles:** the owner adds sitters and other owners in **More → Team**. Sitters start and complete visits and publish updates; prices, settings, money and staff accounts are the owner's. Changing staff accounts, downloading or restoring a backup, and refunds ask the owner to re-enter their password if it was last entered more than 15 minutes ago.
- **Pets and care:** pet profiles in five cards with a tab-local draft, field help and validation. **Care details** holds the required care intake (saved whole or a group at a time), the service agreement, vaccine records with PDF/image uploads, and encrypted home-entry instructions that staff can reveal only around the visit. Each pet has a care timeline.
- **Booking:** customers choose a service, pets and an available time; full days are not offered. Quotes are priced on the server (peak dates, short-notice fee, puppies, extra pets, nightly stays) and itemized. Review holds the selected time for up to 10 minutes. Sending the request releases the hold and creates a pending booking; requirements still missing (intake, Meet & Greet, vaccines, agreement) are listed with links. Staff approve, decline, reschedule and cancel; customers cancel or request a new time under the cancellation terms. Overlapping approvals and approvals outside available hours are rejected. The price is snapshotted on the booking. Overnight stays have a two-month date picker.
- **Visits and diary:** staff start and complete visits (a summary and a departure check are required), publish activity updates with structured answers and an optional photo, and customers see them grouped by visit (by night for stays). Photo access is checked per request, and photo metadata (including GPS) is removed on upload. Customers can leave private feedback.
- **Money:** payment status and balance on every booking, tips and an automatic tip, staff-recorded cash/check payments and refunds, cancellation fees per service, and Stripe Checkout when configured. Packages and recurring visits have APIs and minimal screens.
- **Unsaved typing is kept:** saving one form doesn't wipe what was typed or chosen in the others, and drafts survive a reload of the tab. Routine answers are kept in the tab's session storage; health and emergency answers in care forms are kept only until the page is left; passwords, entry instructions and codes are never kept. Drafts clear on sign-out, on an account change and when the form is saved.
- **Safe retries:** every portal form sends an `Idempotency-Key`; if the connection drops, the portal retries and the server runs the write once (bookings, approvals, diary updates and so on).
- **Dashboards:** clients and staff land on separate home screens with task buttons and a swipeable seven-day calendar. Staff Financials shows booking-price totals and a completed-visit breakdown by service (the API also reports money received and outstanding).
- **Staff tools:** service setup, repeating weekly hours with editable buffers, custom hours or closures by date, extra appointment windows, customer records with private notes, vaccine and agreement settings, and diary publishing. The calendar uses Massachusetts time. The client diary refreshes on entry and has one native dropdown for pet or visit filtering.
- **Operations:** downloadable and daily scheduled backups, restore into a new installation, and a notification outbox (EN/ES) that sends once an email driver is added.

## Not built yet

- **Waiting for screens (the server side exists):** recurring visits, fee rules and packages management; the guest price and ZIP check before sign-in; the visit page and post-request confirmation with next steps; the self-refreshing diary; the forgotten-password form. See [the Codex UX plan](docs/plans/codex-ux-plan.md).
- **Waiting for owner decisions:** balance timing beyond "before the visit", no-shows, and the price checks in the Decisions table.
- **Waiting for a provider:** sending email (messages and reset links are queued).
- **Not started:** invoices or receipts, email verification, care plans and per-visit checklists, structured medication logging (today “Medication” is a free-text activity type), GPS walk tracking and distance (“Walk started/completed” are diary labels only), messaging, and editing or deleting published diary updates.

## Existing integrations

Stripe Checkout, switched off unless `MYO_PAYMENTS=stripe` and its two secrets are set. There is no email provider or analytics. Fonts fall back to files served from `raw.githubusercontent.com` if the local copies fail to load.

## Known limitations

- Browser coverage is Chromium only (1440×900, 390×844 and 320 px, English and Spanish); the latest walkthrough is the [UX flow audit](docs/ux-flow-audit.md) of November 19, 2026. Safari, Firefox, real phones and the deployed Worker still need verification.
- An earlier Windows run had two restore-script exit-code failures; the [launch iteration report](docs/audits/2026-11-18-launch-iteration.md) records a fix, not yet re-run on Windows. Rehearse a restore on staging.
- The app has **not been deployed to Cloudflare yet**; it has only run under `wrangler dev` locally. The first real deploy should be checked by hand.
- Rate-limit counters live in memory (in the single Durable Object on Cloudflare), so they reset when it restarts.
- Lockouts: 8 failed passwords per account and address per 15 minutes; 50 per account per hour from devices that have never signed in to it; a device that has signed in before (it holds a `myo_device` cookie) has its own 8-per-15-minutes allowance and ignores the other two. So a guesser locks out only themselves, and a large distributed attack can block new devices for an hour but never the owner's known phone or computer.
- The first staff account (the owner) is created from environment variables. The owner adds sitters and other owners in **More → Team**; sitters run visits but can't change prices, settings or money. Without email, the owner hands over each temporary password.
- Visits can start from the visit buffer (default 30 minutes) before their booked time. In launch mode the deposit-based cancellation terms apply (free 7+ days ahead, then 50% of the deposit paid); in catalog mode fees are set per service (0% until Myomi sets one). No-shows have no policy yet.
- The service-area check uses ZIP-code centres, so homes near the 15-mile edge are flagged for Myomi to confirm. Connecticut ZIPs inside the radius count as in the area.
- The current list of open work, decisions and usability findings is in [DEVELOPMENT_HANDOFF.md §5](DEVELOPMENT_HANDOFF.md#5-what-is-still-open-as-of-november-19-2026).
- `sitemap.xml` and `robots.txt` still point at GitHub Pages; update them once the Cloudflare domain is chosen.

## Decisions still needed

| Area | Needed |
| --- | --- |
| Service area and pricing | Configured in `assets/myo-config.js`: 15 miles from Springfield 01108, 10 visits a day, $30 per 30-minute walk or drop-in ($44 on peak dates, +$20 for 60 minutes, $39 puppy), $95 overnight (+$44 per peak night), extra pets $21 (dog) / $13 (cat), $15 short-notice fee. Still to confirm there: the peak puppy rate ($44 or $53), the Christmas 2026 dates, and whether Connecticut ZIPs are served. |
| Policies | Decided and enforced (Nov 19, 2026): 3 days' notice for visits and 7 for stays; a 50% deposit due 48 hours after the request is sent; cancelling 7+ days ahead is free, later Myomi keeps 50% of the deposit; one Meet & Greet per client, booked 24 hours ahead. Still to decide: whether a new pet needs its own meeting, balance timing, no-shows, photo and location consent, data retention. |
| Launch content | Contact and social links, portrait and photos, testimonials with permission, review of English and Spanish copy. |
| Production domain | Hosting is decided (Cloudflare Workers + Durable Object + R2). Choose the public domain, then fix `sitemap.xml` and `robots.txt`. |
| Payments and email | Stripe Checkout is built; supply live keys and a webhook to turn it on. Choose an email provider and sending domain (needed for receipts, notifications and password recovery). |
| Google reviews | Decide when to begin asking for reviews and supply the public profile and review-request URLs. |
| GPS | If walks must track with the phone locked, prototype a native staff app; decide what route data to keep and show. |

Set the public Google Business Profile URLs in `assets/review-links.js`. The `write` URL enables **Leave a Google review** in client Account settings. The button beneath the homepage testimonial cards becomes clickable when the `read` URL is set.

## Documentation

- [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md): current engineering status, API reference and open work.
- [docs/ux-flow-audit.md](docs/ux-flow-audit.md): the direct-booking UX audit (November 19, 2026), with [Claude's](docs/plans/claude-ux-plan.md) and [Codex's](docs/plans/codex-ux-plan.md) remediation plans and their handoff notes.
- [docs/competitive-audit.md](docs/competitive-audit.md) and [docs/plans/claude-plan.md](docs/plans/claude-plan.md) / [codex-plan.md](docs/plans/codex-plan.md): the feature roadmap (Phases 1–3) and its status.
- [Launch iteration report](docs/audits/2026-11-18-launch-iteration.md) and [usability test](docs/audits/2026-11-18-usability-test.md).
- [MYO_AUDIT.md](MYO_AUDIT.md): the earlier audit, findings and remediation log.
- [docs/handoff.md](docs/handoff.md) and [docs/audits/](docs/audits/): earlier notes, kept for history.
- [Sitewide audit and next steps](docs/audits/myo-sitewide-audit-and-next-steps.md) and [live UX friction log](docs/audits/myo-live-ux-friction-log.md): dated snapshots from the local audit and the first desktop and mobile walkthrough.
- [docs/archive/design-previews/](docs/archive/design-previews/): retired mockups. They are not served. Rebuild their stylesheet with `npm ci` then `npm run build`.
