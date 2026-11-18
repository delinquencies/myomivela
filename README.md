# myomivela

myo. is Myomi’s pet-care website and portal. Customers request visits and read a private Pet Diary. Staff publish availability, approve requests, run visits and post updates with photos.

## Status at a glance

- **Implemented:** booking review and a temporary appointment hold, then request, approval, visit, diary update and completion summary. See [What works today](#what-works-today).
- **Built but switched off or without screens:** online payment (Stripe, off until configured), recurring visits, fee rules and packages (APIs and minimal UI), and the notification outbox (no email provider yet).
- **Not implemented:** invoices or receipts, care checklists, GPS walk tracking, messaging, sending email, and password recovery. See [Not built yet](#not-built-yet).
- **Not production-ready for public launch.** Read [Known limitations](#known-limitations) and the [audit](MYO_AUDIT.md) first.

## Technology and structure

**Cloudflare is the production target.** One Worker serves the public site and portal as static assets and forwards `/api/` to a single Durable Object, which holds the SQLite database. Photos are stored in R2. The same app code also runs on Node.js (22.13 or newer) for local development and the fast test suite, with `node:sqlite` and photos on disk. Both runtimes share everything in `lib/`; only `worker.mjs` and `server.mjs` differ. There are **no runtime dependencies** (Wrangler is a dev dependency). The front end is plain HTML, CSS and ES modules.

```
worker.mjs            Cloudflare entry: static assets, security headers, and the MyoApi Durable Object
wrangler.jsonc        Cloudflare config: assets, Durable Object, R2 bucket
server.mjs            Node entry (local dev and tests): bridges node:http to the same app
lib/config.mjs        Every environment variable, and the production checks
lib/db.mjs            Ordered migrations, query helpers, transaction(), photo storage (runtime-neutral)
lib/stores/           Storage adapters: node.mjs (node:sqlite + files), durable.mjs (Durable Object SQLite + R2)
lib/validate.mjs      Input checks (requireThat, field, integer, email) and JSON body reading
lib/auth.mjs          Password hashing, sessions and cookies, admin bootstrap, rate limiting
lib/domain.mjs        Service names, activity types, status transitions, booking step
lib/scheduling.mjs    Windows, bookable start times, overlap checks
lib/bookings.mjs      Access-checked booking queries and page cursors
lib/idempotency.mjs   Safe retries: a write repeated with the same Idempotency-Key runs once
lib/backup.mjs        Whole-installation backup (streamed, gzip JSON) and restore into an empty installation
lib/photos.mjs        Upload validation; lib/image.mjs strips EXIF/XMP/text metadata
lib/api.mjs           Route table and access rules (public / user / staff), origin check
lib/routes/           Handlers: account, portal, diary, bookings, admin
lib/headers.mjs       Security headers (CSP etc.), JSON errors, URL decoding
lib/site.mjs          Which files are public; used by the Node static server and the Cloudflare build
lib/static.mjs        Node only: serves the public files
assets/portal.js      Customer and staff portal (renders into portal/index.html)
assets/drafts.js      Keeps unsaved form input across re-renders and tab reloads (sessionStorage, cleared on sign-out)
assets/diary.js       Diary rendering shared by the portal and the public sample
assets/home.js        Public site: language switch, service cards
assets/*.css          Checked-in styles (no build step)
index.html, myo/      Public homepage, FAQ, sample diary
portal/index.html     Portal shell
scripts/build-site.mjs  Copies the public files into dist/site for Cloudflare (run automatically by wrangler)
scripts/restore.mjs   Restores a downloaded backup into a new installation over the API (any runtime)
scripts/backup.mjs    Consistent, verified copy of the local Node database file
tests/                node:test suites (API, pagination, routes, images, operations); tests/browser/ smoke test
.github/workflows/    CI: `npm test` on Node 22 and 24, and `npm run test:worker` on the Cloudflare runtime
docs/                 Handoff notes, earlier audits, archived design previews
MYO_AUDIT.md          Current audit with remediation log
DEVELOPMENT_HANDOFF.md  Where Claude stopped, and what Codex should do next
```

## Current launch iteration

The approved launch rates in `assets/myo-config.js` now price live server quotes, holds, requests and reviewed reschedules by default. The public calculator and generated service agreements use the same configuration. `MYO_PRICING_MODE=catalog` explicitly retains staff-defined catalog pricing for existing installations and compatibility fixtures. Existing booking totals are retained until a reviewed reschedule.

Customers use **Care details** to save all required intake and emergency information, accept the current agreement and save encrypted home-entry instructions. Pet cards offer vaccine records with PDF/image uploads and a care timeline. Staff can configure vaccine requirements, publish bilingual agreement versions, reveal entry details within the visit window, publish structured activity answers, and manage private client or pet notes. Overnight bookings have a two-month date picker and a diary grouped by night.

In launch mode, each paid booking requires saved intake and its own completed complimentary Meet & Greet. Cancelling a booking releases that Meet & Greet for a replacement request. The ten-visit daily limit is checked on quotes and confirmation. Short notice uses Massachusetts calendar days and adds the configured fee. The first attending pet in the displayed list determines the base rate.

Main now includes Stripe Checkout, payment/refund records, recurring and package APIs, staff roles and scheduled backups. Live payment credentials and an email driver remain unconfigured. The launch-specific 50% deposit and 48-hour unpaid-request expiry still require integration. Current requests continue through Myomi’s approval flow. See the [iteration report](docs/audits/2026-11-18-launch-iteration.md) for verified work and open dependencies.

## Run locally

```sh
npm start      # Node, at http://127.0.0.1:45838/
npm run dev    # the Cloudflare runtime locally (wrangler dev), at http://127.0.0.1:8787/
```

Open <http://127.0.0.1:45838/>. Use separate browser profiles or a private window for the [client portal](http://127.0.0.1:45838/portal/) and the [staff sign-in](http://127.0.0.1:45838/portal/?staff=1#diary), because they use different sessions.

### Environment variables

Names only; set them in the shell (Node), as `--var` flags or a git-ignored `.dev.vars` file (`npm run dev`), or as Cloudflare secrets (production). Never commit values. On Cloudflare only `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` and `MYO_VAULT_KEY` are needed: the Worker sees the real https URL and Cloudflare's `CF-Connecting-IP`, so the origin, cookie and proxy settings are automatic.

| Variable | Purpose |
| --- | --- |
| `MYO_DB` | Node only. SQLite file path. Default `.myo/data.sqlite` (ignored by git); photos go in a `photos` folder next to it. |
| `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` | Creates the staff account at startup if that email does not exist (password 12–128 characters). Changing the password variable later does **not** change an existing account; change it in the portal under **Account** instead. |
| `PORT`, `HOST` | Listener. Defaults `45838` and `127.0.0.1`. |
| `NODE_ENV` | Node only. `production` makes the server refuse to start unless `MYO_ORIGIN` is an `https://` origin and `MYO_SECURE_COOKIES=1`. |
| `MYO_ORIGIN` | Exact public origin (for example `https://example.com`). Browser POSTs with a different `Origin` are rejected. Without it the server expects `http://<host>`. |
| `MYO_SECURE_COOKIES` | `1` adds `Secure` to the session cookie and sends HSTS. Required in production. |
| `MYO_VAULT_KEY` | Required in production (Node refuses to start without it). Base64 of 32 random bytes, for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Encrypts customers' entry instructions. Keep it with your backups: a restored database needs the same key. To rotate, move the old value to `MYO_VAULT_KEY_PREVIOUS` and set a new one; records are re-encrypted as they're read. |
| `MYO_PAYMENTS` | Optional. `stripe` turns on online payment through Stripe Checkout (needs the two Stripe settings below). Unset: staff record payments by hand. `fake` is for tests and is refused in production. |
| `MYO_STRIPE_SECRET_KEY` | With `MYO_PAYMENTS=stripe`. A restricted key that can create Checkout Sessions and Refunds. Secret. |
| `MYO_STRIPE_WEBHOOK_SECRET` | With `MYO_PAYMENTS=stripe`. The signing secret of a Stripe webhook endpoint at `/api/payments/webhook`, sending `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` and `refund.created`/`refund.updated`. Secret. |
| `MYO_EMAIL` | Optional. No email provider is connected yet, so messages wait in the outbox (staff: `GET /api/outbox`). `log` marks them sent without sending (tests). |
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

1. Sign in as staff. Under **Services & availability**, set a price and duration and publish a future appointment window. Customers can book any 30-minute start inside the window that is long enough for the service. Staff enter the window in their device’s time zone; the portal displays Massachusetts time.
2. In another profile, register as a customer from a service card, add a pet, choose a time and submit.
3. As staff, approve the request, start the visit, publish a diary update with a photo, then complete the visit with a summary.
4. As the customer, open **Pet Diary**. A second customer must not be able to open the update or its photo.
5. Still open: run this on real iPhone and Android devices, including the camera and photo-library buttons.

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

`npm run deploy` copies the public files into `dist/site`, bundles `worker.mjs` and uploads both. The first deploy creates the `MyoApi` Durable Object and its database, and the staff account is created on the first API request. The site is then live at `myo.<your-subdomain>.workers.dev`. To serve it on your own domain, add it under the Worker's **Settings → Domains & Routes** in the Cloudflare dashboard. Every later change ships with `npm run deploy`.

## Database and migrations

SQLite in both runtimes: the Durable Object's built-in SQLite on Cloudflare, `node:sqlite` locally. The schema is created and upgraded automatically on start by the ordered `migrations` list in `lib/db.mjs`. The applied count is stored in the `meta` table (`schema_version`, currently 26), because Durable Objects do not allow `PRAGMA user_version`. To change the schema, **append** a migration that is safe to re-run. Never edit an earlier one. Photos are not in the database: they are stored in R2 (Cloudflare) or files (Node) under the event's `photo_key`.

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
npm run test:browser # end-to-end portal run in Chromium (needs Playwright); MYO_TARGET=worker runs it on the Worker
npm run build  # only rebuilds the archived design-preview stylesheet (needs `npm ci`); the live site has no build
```

There is no linter or type checker configured. CI is defined in `.github/workflows/test.yml`. [GitHub CI for the booking and weekly availability update](https://github.com/delinquencies/myomivela/actions/runs/44227268734) passed on Node 22, Node 24, and the local Cloudflare runtime. The browser smoke test runs separately.

## What works today

- **Public site:** bilingual (English/Spanish) homepage, About Myomi and FAQ, service cards linking to booking, and an English sample diary using the same visit card as the private diary.
- **Accounts:** customer registration, sign-in and sign-out with scrypt password hashes and hashed server-side sessions. Under **Account**, anyone can change their password (other devices are signed out) or sign out everywhere. Failed sign-ins lock out the guessing address, never the owner's devices (see below).
- **Pets:** create a profile in five cards with a tab-local draft, field help and validation. Existing profiles can be edited in one form.
- **Booking:** customers choose a service, pets and an available time. The homepage cards show published rates and the booking entry previews upcoming times before sign-in. Review holds the selected time for up to 10 minutes and shows the quote and Myomi as the sitter. Sending the request releases the hold and creates a pending booking. Staff still approve, decline, reschedule and cancel. Customers can cancel or reschedule within the app's current rules. Overlapping approvals and approvals outside available hours are rejected. The price is snapshotted on the booking.
- **Visits and diary:** staff start and complete visits (a summary is required), publish typed activity updates with an optional photo, and customers see them grouped by visit. Photo access is checked per request, and photo metadata (including GPS) is removed on upload.
- **Unsaved typing is kept:** saving one form no longer wipes what was typed or chosen in the others (including a half-filled booking, open editors and a chosen photo), and drafts survive a reload of the tab. They are kept in the tab's session storage, cleared on sign-out and when the form is saved; passwords are never kept.
- **Safe retries:** every portal form sends an `Idempotency-Key`; if the connection drops, the portal retries and the server runs the write once (bookings, approvals, diary updates and so on).
- **Dashboards:** clients and staff land on separate home screens with task buttons and a swipeable seven-day calendar. Staff Financials shows booking-price totals and a completed-visit breakdown by service.
- **Staff tools:** service prices and durations, repeating weekly hours with editable buffers, custom hours or closures by date, extra appointment windows, and diary publishing. Regular hours start generating bookable times after Myomi saves the schedule. The calendar uses Massachusetts time. The client diary refreshes on entry and has one native dropdown for pet or visit filtering.

## Not built yet

Screens for recurring visits, fee rules and packages (their APIs exist), sending email (messages are queued but no provider is connected), invoices or receipts, care plans and per-visit checklists, structured medication logging (today “Medication” is a free-text activity type), GPS walk tracking and distance (“Walk started/completed” are diary labels only), messaging, email and other outbound notifications, email verification and password recovery, and editing or deleting published diary updates.

## Existing integrations

Stripe Checkout, switched off unless `MYO_PAYMENTS=stripe` and its two secrets are set. There is no email provider or analytics. Fonts fall back to files served from `raw.githubusercontent.com` if the local copies fail to load.

## Known limitations

- The Nov 17, 2026 local audit exercised the public pages and portal at 320, 390, 768 and 1280 CSS pixels in Chromium. The 390 px booking and diary browser suite passed. Safari, Firefox, real phones and the deployed Worker still need verification for the current changes.
- The Node suite passed 48 of 50 tests on Windows after the weekly-hours migration and schema assertion updates. The two remaining restore CLI exit-code assertions also failed on the clean baseline. The green GitHub run does not reproduce the Windows restore CLI issue. Recheck it and rehearse a restore on staging.
- The app has **not been deployed to Cloudflare yet**; it has only run under `wrangler dev` locally. The first real deploy should be checked by hand.
- Rate-limit counters live in memory (in the single Durable Object on Cloudflare), so they reset when it restarts.
- Lockouts: 8 failed passwords per account and address per 15 minutes; 50 per account per hour from devices that have never signed in to it; a device that has signed in before (it holds a `myo_device` cookie) has its own 8-per-15-minutes allowance and ignores the other two. So a guesser locks out only themselves, and a large distributed attack can block new devices for an hour but never the owner's known phone or computer.
- The first staff account (the owner) is created from environment variables. The owner adds sitters and other owners in **Settings → Staff**; sitters run visits but can't change prices, settings or money. Without email, the owner hands over each temporary password.
- Visits can start from the visit buffer (default 30 minutes) before their booked time. Cancellation fees are set per service (0% until Myomi sets one); no-shows have no policy yet.
- The current list of open work, decisions and usability findings is in [DEVELOPMENT_HANDOFF.md §5](DEVELOPMENT_HANDOFF.md#5-what-is-still-open-as-of-november-18-2026).
- `sitemap.xml` and `robots.txt` still point at GitHub Pages; update them once the Cloudflare domain is chosen.

## Decisions still needed

| Area | Needed |
| --- | --- |
| Service area and pricing | Confirm towns/ZIP codes, services, visit lengths, hours, capacity and fees. Proposed client-review rates: **$30 / 30-minute walk**, **$35 / 30-minute drop-in**, **$110 / in-home overnight**. |
| Policies | Cancellation, rescheduling, refund and payment timing; required care and emergency details; home access, emergency authorization, photo and location consent, retention. |
| Launch content | Contact and social links, portrait and photos, testimonials with permission, review of English and Spanish copy. |
| Production domain | Hosting is decided (Cloudflare Workers + Durable Object + R2). Choose the public domain, then fix `sitemap.xml` and `robots.txt`. |
| Payments and email | Choose providers and approve rules for instant payment within published windows, manual exceptions, confirmation and receipts, cancellations and refunds. |
| Google reviews | Decide when to begin asking for reviews and supply the public profile and review-request URLs. |
| GPS | If walks must track with the phone locked, prototype a native staff app; decide what route data to keep and show. |

Set the public Google Business Profile URLs in `assets/review-links.js`. The `write` URL enables **Leave a Google review** in client Account settings. The button beneath the homepage testimonial cards becomes clickable when the `read` URL is set.

## Documentation

- [MYO_AUDIT.md](MYO_AUDIT.md): findings, statuses and the remediation log.
- [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md): current engineering status and the [usability test brief for Claude](DEVELOPMENT_HANDOFF.md#7-usability-and-ux-test-for-claude).
- [docs/handoff.md](docs/handoff.md) and [docs/audits/](docs/audits/): earlier notes, kept for history.
- [Sitewide audit and next steps](docs/audits/myo-sitewide-audit-and-next-steps.md) and [live UX friction log](docs/audits/myo-live-ux-friction-log.md): dated snapshots from the local audit and the first desktop and mobile walkthrough.
- [docs/archive/design-previews/](docs/archive/design-previews/): retired mockups. They are not served. Rebuild their stylesheet with `npm ci` then `npm run build`.
