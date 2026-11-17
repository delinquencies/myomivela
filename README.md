# myomivela

myo. is Myomi’s pet-care website and portal. Customers request visits and read a private Pet Diary. Staff publish availability, approve requests, run visits and post updates with photos.

## Status at a glance

- **Implemented:** the flow from request to approval, visit, diary update and completion summary, with data stored in SQLite. See [What works today](#what-works-today).
- **Not implemented:** payments, recurring bookings and packages, care checklists, GPS walk tracking, messaging, email and notifications, password recovery, and a Spanish portal. See [Not built yet](#not-built-yet).
- **Not production-ready for public launch.** Read [Known limitations](#known-limitations) and the [audit](MYO_AUDIT.md) first.

## Technology and structure

Node.js (22.13 or newer; the tests and CI use 22 and 24) with the built-in `node:http` and `node:sqlite` modules. There are **no runtime dependencies**. The front end is plain HTML, CSS and ES modules. `node:sqlite` is still marked experimental by Node and prints a warning at startup.

```
server.mjs            Start-up checks and the HTTP server; wires the modules below
lib/config.mjs        Every environment variable, and the production checks
lib/db.mjs            SQLite connection, ordered migrations, query helpers, transaction()
lib/validate.mjs      Input checks (requireThat, field, integer, email) and JSON body reading
lib/auth.mjs          Password hashing, sessions and cookies, admin bootstrap, rate limiting
lib/domain.mjs        Service names, activity types, status transitions, booking step
lib/scheduling.mjs    Windows, bookable start times, overlap checks
lib/bookings.mjs      Access-checked booking queries and page cursors
lib/photos.mjs        Upload validation; lib/image.mjs strips EXIF/XMP/text metadata
lib/api.mjs           Route table and access rules (public / user / staff), origin check
lib/routes/           Handlers: account, portal, diary, bookings, admin
lib/static.mjs        Security headers (CSP etc.) and the allow-listed static files
assets/portal.js      Customer and staff portal (renders into portal/index.html)
assets/diary.js       Diary rendering shared by the portal and the public sample
assets/home.js        Public site: language switch, service cards
assets/*.css          Checked-in styles (no build step)
index.html, myo/      Public homepage, FAQ, sample diary
portal/index.html     Portal shell
scripts/backup.mjs    Consistent, verified SQLite backup
scripts/scrub-photos.mjs  One-time metadata scrub for photos stored before stripping existed
tests/                node:test suites (API, pagination, routes, images, operations); tests/browser/ smoke test
.github/workflows/    CI: runs `npm test` on Node 22 and 24
docs/                 Handoff notes, earlier audits, archived design previews
MYO_AUDIT.md          Current audit with remediation log
DEVELOPMENT_HANDOFF.md  Where Claude stopped, and what Codex should do next
```

## Run locally

```sh
npm start
```

Open <http://127.0.0.1:45838/>. Use separate browser profiles or a private window for the [client portal](http://127.0.0.1:45838/portal/) and the [staff sign-in](http://127.0.0.1:45838/portal/?staff=1#diary), because they use different sessions.

### Environment variables

Names only; set them in the shell or your host. Never commit values.

| Variable | Purpose |
| --- | --- |
| `MYO_DB` | SQLite file path. Default `.myo/data.sqlite` (ignored by git). Keep it on private storage. |
| `MYO_ADMIN_EMAIL`, `MYO_ADMIN_PASSWORD` | Creates the staff account at startup if that email does not exist (password 12–128 characters). Changing the password variable later does **not** change an existing account. |
| `PORT`, `HOST` | Listener. Defaults `45838` and `127.0.0.1`. |
| `NODE_ENV` | `production` makes the server refuse to start unless `MYO_ORIGIN` is an `https://` origin and `MYO_SECURE_COOKIES=1`. |
| `MYO_ORIGIN` | Exact public origin (for example `https://example.com`). Browser POSTs with a different `Origin` are rejected. Without it the server expects `http://<host>`. |
| `MYO_SECURE_COOKIES` | `1` adds `Secure` to the session cookie and sends HSTS. Required in production. |
| `MYO_TRUST_PROXY` | `1` takes the client address from the last `X-Forwarded-For` entry; `cloudflare` uses `CF-Connecting-IP`. Set only when exactly one trusted proxy sits in front, otherwise leave unset. Used for rate limiting. |

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

## Database and migrations

SQLite via `node:sqlite`. The schema is created and upgraded automatically at startup by the ordered `migrations` list in `lib/db.mjs`; the applied count is stored in `PRAGMA user_version` (currently 3). To change the schema, **append** a migration. Never edit an earlier one. An older database opens and upgrades in place (covered by a test).

Backups and maintenance:

```sh
npm run backup -- backups/myo-$(date +%F).sqlite   # consistent copy, safe while the server runs; verified; never overwrites
node scripts/scrub-photos.mjs                       # dry run: photos stored before metadata stripping
node scripts/scrub-photos.mjs --apply               # after taking a backup
```

Restore by stopping the server and copying a backup over `MYO_DB`. Scheduling backups and keeping copies off the machine is a deployment task that is not set up.

## Tests and builds

```sh
npm test       # 32 tests; starts the server on free ports with temporary databases
npm run test:browser   # end-to-end portal run in Chromium (needs Playwright); fails on any CSP or console error
npm run build  # only rebuilds the archived design-preview stylesheet (needs `npm ci`); the live site has no build
```

There is no linter or type checker configured. CI is defined in `.github/workflows/test.yml`.

## What works today

- **Public site:** bilingual (English/Spanish) homepage and FAQ, service cards linking to booking, and a fictional sample diary using the same layout as the real one.
- **Accounts:** customer registration, sign-in and sign-out with scrypt password hashes, hashed server-side sessions, and a per-address and per-account rate limit.
- **Pets:** create and edit pet profiles (breed, medical, diet, emergency contacts and notes as one JSON profile).
- **Booking:** customers request a service for one or more of their pets at a start time on a 30-minute grid inside staff-published windows. Staff approve, decline, reschedule and cancel; customers can cancel or reschedule. Overlapping approvals and approvals for withdrawn windows are rejected. The price is snapshotted on the booking.
- **Visits and diary:** staff start and complete visits (a summary is required), publish typed activity updates with an optional photo, and customers see them grouped by visit. Photo access is checked per request, and photo metadata (including GPS) is removed on upload.
- **Staff tools:** service prices and durations, appointment windows, today’s visits, history, and diary publishing.

## Not built yet

Payments and checkout (Stripe), recurring bookings and packages, care plans and per-visit checklists, structured medication logging (today “Medication” is a free-text activity type), GPS walk tracking and distance (“Walk started/completed” are diary labels only), messaging, email and other notifications, email verification and password recovery, a Spanish portal, editing or deleting published diary updates, customer search and management for staff, and pagination of long histories.

## Existing integrations

None. There is no payment provider, email provider or analytics. Fonts fall back to files served from `raw.githubusercontent.com` if the local copies fail to load.

## Known limitations

- Portal changes for the start-time grid and the new Content-Security-Policy have **not been exercised in a real browser** or on phones.
- Rate-limit counters live in server memory (reset on restart, not shared between instances).
- Account lockout after repeated failures also locks out the real owner for 15 minutes.
- Staff is a single shared account created from environment variables; there is no password change or second staff user.
- The whole diary and booking history is returned on each portal load (no pagination).
- Photos are stored inside the database file.
- Booking lifecycle policy (no-show, early start, cancellation cutoffs) is undecided and unenforced.
- `sitemap.xml` and `robots.txt` point at GitHub Pages, which cannot run the portal. Production hosting is undecided (see below).

## Decisions still needed

| Area | Needed |
| --- | --- |
| Service area and pricing | Confirm towns/ZIP codes, services, visit lengths, hours, capacity and fees. Proposed client-review rates: **$30 / 30-minute walk**, **$35 / 30-minute drop-in**, **$110 / in-home overnight**. |
| Policies | Cancellation, rescheduling, refund and payment timing; required care and emergency details; home access, emergency authorization, photo and location consent, retention. |
| Launch content | Contact and social links, portrait and photos, testimonials with permission, review of English and Spanish copy. |
| Production hosting | The server needs Node and a persistent disk. The earlier plan was Cloudflare Workers + D1 + R2, which requires rewriting the API and atomic booking logic; a Node host with backups is a shorter path. Decide before building more. |
| Payments and email | Choose providers and approve payment timing before integrating. |
| GPS | If walks must track with the phone locked, prototype a native staff app; decide what route data to keep and show. |

## Documentation

- [MYO_AUDIT.md](MYO_AUDIT.md): findings, statuses and the remediation log.
- [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md): what changed and the next tasks for Codex.
- [docs/handoff.md](docs/handoff.md) and [docs/audits/](docs/audits/): earlier notes, kept for history.
- [docs/archive/design-previews/](docs/archive/design-previews/): retired mockups. They are not served. Rebuild their stylesheet with `npm ci` then `npm run build`.
