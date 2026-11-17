# myomivela

myo. is Myomi’s pet-care website and portal. Customers request visits and read a private Pet Diary. Staff publish availability, approve requests, run visits and post updates with photos.

## Status at a glance

- **Implemented:** the flow from request to approval, visit, diary update and completion summary, with data stored in SQLite. See [What works today](#what-works-today).
- **Not implemented:** payments, recurring bookings and packages, care checklists, GPS walk tracking, messaging, email and notifications, password recovery, and a Spanish portal. See [Not built yet](#not-built-yet).
- **Not production-ready for public launch.** Read [Known limitations](#known-limitations) and the [audit](MYO_AUDIT.md) first.

## Technology and structure

**Production runs on Cloudflare**: one Worker serves the public site and portal as static assets and forwards `/api/` to a single Durable Object, which holds the SQLite database. Photos are stored in R2. The same app code also runs on Node.js (22.13 or newer) for local development and the fast test suite, with `node:sqlite` and photos on disk. Both runtimes share everything in `lib/`; only `worker.mjs` and `server.mjs` differ. There are **no runtime dependencies** (Wrangler is a dev dependency). The front end is plain HTML, CSS and ES modules.

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

## Run locally

```sh
npm start      # Node, at http://127.0.0.1:45838/
npm run dev    # the Cloudflare runtime locally (wrangler dev), at http://127.0.0.1:8787/
```

Open <http://127.0.0.1:45838/>. Use separate browser profiles or a private window for the [client portal](http://127.0.0.1:45838/portal/) and the [staff sign-in](http://127.0.0.1:45838/portal/?staff=1#diary), because they use different sessions.

### Environment variables

Names only; set them in the shell (Node), as `--var` flags or a git-ignored `.dev.vars` file (`npm run dev`), or as Cloudflare secrets (production). Never commit values. On Cloudflare only `MYO_ADMIN_EMAIL` and `MYO_ADMIN_PASSWORD` are needed: the Worker sees the real https URL and Cloudflare's `CF-Connecting-IP`, so the origin, cookie and proxy settings are automatic.

| Variable | Purpose |
| --- | --- |
| `MYO_DB` | Node only. SQLite file path. Default `.myo/data.sqlite` (ignored by git); photos go in a `photos` folder next to it. |
| `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` | Creates the staff account at startup if that email does not exist (password 12–128 characters). Changing the password variable later does **not** change an existing account; change it in the portal under **Account** instead. |
| `PORT`, `HOST` | Listener. Defaults `45838` and `127.0.0.1`. |
| `NODE_ENV` | Node only. `production` makes the server refuse to start unless `MYO_ORIGIN` is an `https://` origin and `MYO_SECURE_COOKIES=1`. |
| `MYO_ORIGIN` | Exact public origin (for example `https://example.com`). Browser POSTs with a different `Origin` are rejected. Without it the server expects `http://<host>`. |
| `MYO_SECURE_COOKIES` | `1` adds `Secure` to the session cookie and sends HSTS. Required in production. |
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
npx wrangler secret put MYO_ADMIN_EMAIL
npx wrangler secret put MYO_ADMIN_PASSWORD
npm run deploy
```

`npm run deploy` copies the public files into `dist/site`, bundles `worker.mjs` and uploads both. The first deploy creates the `MyoApi` Durable Object and its database, and the staff account is created on the first API request. The site is then live at `myo.<your-subdomain>.workers.dev`. To serve it on your own domain, add it under the Worker's **Settings → Domains & Routes** in the Cloudflare dashboard. Every later change ships with `npm run deploy`.

## Database and migrations

SQLite in both runtimes: the Durable Object's built-in SQLite on Cloudflare, `node:sqlite` locally. The schema is created and upgraded automatically on start by the ordered `migrations` list in `lib/db.mjs`. The applied count is stored in the `meta` table (`schema_version`, currently 6), because Durable Objects do not allow `PRAGMA user_version`. To change the schema, **append** a migration that is safe to re-run. Never edit an earlier one. Photos are not in the database: they are stored in R2 (Cloudflare) or files (Node) under the event's `photo_key`.

### Backups and restore

**Download backup** (staff portal, **Services & availability**, or `GET /api/backup` as staff) saves the whole installation as one `myo-backup-<date>.json.gz` file. It includes accounts, pets, services, windows, bookings, diary updates and every photo, and works the same on Cloudflare and Node. All tables are read in one consistent pass. Sessions are not included. **The file contains password hashes and customers' personal details: store it privately**, for example in an encrypted drive, never in the repository or a shared folder. Downloads are manual for now; nothing schedules them.

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
npm test             # 49 tests against Node; starts the server on free ports with temporary databases
npm run test:worker  # the same suites against the Cloudflare runtime (wrangler dev); Node-only tests are skipped
npm run test:browser # end-to-end portal run in Chromium (needs Playwright); MYO_TARGET=worker runs it on the Worker
npm run build  # only rebuilds the archived design-preview stylesheet (needs `npm ci`); the live site has no build
```

There is no linter or type checker configured. CI is defined in `.github/workflows/test.yml`.

## What works today

- **Public site:** bilingual (English/Spanish) homepage and FAQ, service cards linking to booking, and a fictional sample diary using the same layout as the real one.
- **Accounts:** customer registration, sign-in and sign-out with scrypt password hashes and hashed server-side sessions. Under **Account**, anyone can change their password (other devices are signed out) or sign out everywhere. Failed sign-ins lock out the guessing address, never the owner's devices (see below).
- **Pets:** create and edit pet profiles (breed, medical, diet, emergency contacts and notes as one JSON profile).
- **Booking:** customers request a service for one or more of their pets at a start time on a 30-minute grid inside staff-published windows. Staff approve, decline, reschedule and cancel; customers can cancel or reschedule. Overlapping approvals and approvals for withdrawn windows are rejected. The price is snapshotted on the booking.
- **Visits and diary:** staff start and complete visits (a summary is required), publish typed activity updates with an optional photo, and customers see them grouped by visit. Photo access is checked per request, and photo metadata (including GPS) is removed on upload.
- **Unsaved typing is kept:** saving one form no longer wipes what was typed or chosen in the others (including a half-filled booking, open editors and a chosen photo), and drafts survive a reload of the tab. They are kept in the tab's session storage, cleared on sign-out and when the form is saved; passwords are never kept.
- **Safe retries:** every portal form sends an `Idempotency-Key`; if the connection drops, the portal retries and the server runs the write once (bookings, approvals, diary updates and so on).
- **Staff tools:** service prices and durations, appointment windows, today’s visits, history, and diary publishing.

## Not built yet

Payments and checkout (Stripe), recurring bookings and packages, care plans and per-visit checklists, structured medication logging (today “Medication” is a free-text activity type), GPS walk tracking and distance (“Walk started/completed” are diary labels only), messaging, email and other notifications, email verification and password recovery, a Spanish portal, editing or deleting published diary updates, and customer search and management for staff.

## Existing integrations

None. There is no payment provider, email provider or analytics. Fonts fall back to files served from `raw.githubusercontent.com` if the local copies fail to load.

## Known limitations

- The portal is tested in Chromium only (`npm run test:browser`), not in Safari or on real phones.
- The app has **not been deployed to Cloudflare yet**; it has only run under `wrangler dev` locally. The first real deploy should be checked by hand.
- Rate-limit counters live in memory (in the single Durable Object on Cloudflare), so they reset when it restarts.
- Lockouts: 8 failed passwords per account and address per 15 minutes; 50 per account per hour from devices that have never signed in to it; a device that has signed in before (it holds a `myo_device` cookie) has its own 8-per-15-minutes allowance and ignores the other two. So a guesser locks out only themselves, and a large distributed attack can block new devices for an hour but never the owner's known phone or computer.
- Staff is a single shared account created from environment variables (its password can be changed in the portal); there is no second staff user.
- Booking lifecycle policy (no-show, early start, cancellation cutoffs) is undecided and unenforced.
- `sitemap.xml` and `robots.txt` still point at GitHub Pages; update them once the Cloudflare domain is chosen.

## Decisions still needed

| Area | Needed |
| --- | --- |
| Service area and pricing | Confirm towns/ZIP codes, services, visit lengths, hours, capacity and fees. Proposed client-review rates: **$30 / 30-minute walk**, **$35 / 30-minute drop-in**, **$110 / in-home overnight**. |
| Policies | Cancellation, rescheduling, refund and payment timing; required care and emergency details; home access, emergency authorization, photo and location consent, retention. |
| Launch content | Contact and social links, portrait and photos, testimonials with permission, review of English and Spanish copy. |
| Production domain | Hosting is decided (Cloudflare Workers + Durable Object + R2). Choose the public domain, then fix `sitemap.xml` and `robots.txt`. |
| Payments and email | Choose providers and approve payment timing before integrating. |
| GPS | If walks must track with the phone locked, prototype a native staff app; decide what route data to keep and show. |

## Documentation

- [MYO_AUDIT.md](MYO_AUDIT.md): findings, statuses and the remediation log.
- [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md): what changed and the next tasks for Codex.
- [docs/handoff.md](docs/handoff.md) and [docs/audits/](docs/audits/): earlier notes, kept for history.
- [docs/archive/design-previews/](docs/archive/design-previews/): retired mockups. They are not served. Rebuild their stylesheet with `npm ci` then `npm run build`.
