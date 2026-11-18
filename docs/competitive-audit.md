# Competitive audit: myo. vs Rover, Wag! and Time To Pet

November 18, 2026 · Repository state: `main` at `ee9d250` · Plans that follow from this audit: [Claude track](plans/claude-plan.md) and [Codex track](plans/codex-plan.md)

**Sources.** Competitor facts come only from three product teardowns supplied by the owner (Rover, Wag! and Time To Pet product and workflow teardowns, reflecting late-2026 U.S. documentation). They were not independently verified. "Not covered" means the teardown doesn't say. Every claim about myo. cites the file, function or schema field it rests on.

**Frame.** myo. is a **direct-to-client** business with one sitter (Myomi), not a two-sided marketplace.
- **Time To Pet** is the operational benchmark.
- **Rover** is the trust and relationship benchmark.
- **Wag!** is the benchmark for dispatch and home-access mechanics.

Marketplace monetisation and liquidity mechanics are out of scope; see [§3.3](#33-intentionally-skip).

**Legend.**
- ✅ **Implemented:** works end to end and is covered by tests in `tests/` or `tests/browser/`.
- 🟡 **Stubbed or UI-only:** visible or promised, but not backed by data or logic, or only partly working.
- ❌ **Missing.**

---

## 1. Current state snapshot

### 1.1 Architecture and roles
- **One app, two runtimes:**
  - **Cloudflare:** `worker.mjs` serves static files and forwards `/api/*` to the `MyoApi` Durable Object.
  - **Node:** `server.mjs` serves local development and the fast tests.
  - **Shared:** both run the same code in `lib/`. Storage goes through the adapters in `lib/stores/` (`durable.mjs` for Durable Object SQLite and R2, `node.mjs` for `node:sqlite` and files).
- **API surface:** one route table, `lib/api.mjs`, assembled from `lib/routes/{account,portal,diary,bookings,admin}.mjs`. Each route declares `access` (`public`, `user` or `staff`), and `tests/routes.test.mjs` checks every rule.
- **Client:** plain ES modules, with no framework and no build step for the app.
  - `assets/portal.js` is the portal: about 1,100 lines of string-rendered HTML through `render()`.
  - Companion modules: `assets/diary.js`, `assets/drafts.js`, `assets/price-sheet.js`, `assets/review-links.js`.
  - The public site is static HTML with `assets/home.js`.
- **Roles** (`users.admin`, migration 1 in `lib/db.mjs`):
  - **One staff account (Myomi):** created from `MYO_ADMIN_EMAIL` and `MYO_ADMIN_PASSWORD` by `ensureAdmin()` (`lib/auth.mjs`). There's no second staff member and no roles.
  - **Customers:** register themselves through `POST /api/register`.
- **Schema** (version 8, append-only migrations in `lib/db.mjs`):
  - `users(id, email, name, password, admin)` and `sessions(token, user, expires)`
  - `pets(id, owner, name, species, details)`, where `details` is profile JSON of at most 3,000 characters
  - `services(id, name, minutes, cents)` with `UNIQUE(name, minutes)`
  - `slots(id, starts, ends)`, the one-off windows
  - `bookings(id, owner, service, starts, ends, cents, notes, status, arrived, departed, summary)` and `booking_pets(booking, pet)`
  - `events(id, booking, pet, kind, notes, published, mime, photo_key)`; the legacy `photo` BLOB is no longer read
  - `idempotency(user, key, fingerprint, status, body, created)` and `trusted_devices(token, user, created)`
  - `checkout_holds(owner, slot, service, starts, ends, expires)`
  - `schedule_settings(id=1, days, opens, closes, buffer)` and `schedule_exceptions(day, opens, closes)`
  - `meta(key, value)`, which holds `schema_version`
- **Booking statuses:** `transitions` in `lib/domain.mjs`: Requested → Confirmed or Cancelled; Confirmed → In Progress or Cancelled; In Progress → Completed.
- **No `AGENTS.md` or `CLAUDE.md`** exists. The working conventions are in `DEVELOPMENT_HANDOFF.md` §2 and `README.md`.

### 1.2 Working flows (✅)
| Flow | Evidence |
|---|---|
| Public site, English and Spanish | `index.html`, `myo/about/index.html`, `myo/safety_first_faq/index.html` use `data-es`, `data-es-label` and `data-es-alt`. `setLanguage()` in `assets/home.js` persists `localStorage['myo-language']`. |
| Public prices and the next times, before sign-in | `GET /api/catalog` fills the homepage `[data-service-price]` tags (`assets/home.js`). `GET /api/availability` gives the next 3 times per service over 14 days (`lib/routes/portal.mjs`), shown by `showPriceSheet()` (`assets/price-sheet.js`) in `auth()`. |
| Account security | `POST /api/register`, `/api/login`, `/api/logout`, `/api/password`, `/api/signout-all` (`lib/routes/account.mjs`). Async scrypt in `passwordHash()`. Lockouts per address and account, with device trust (`passwordGuard()`, `rememberDevice()`; table `trusted_devices`). Tests: `tests/accounts.test.mjs`. |
| Pet intake | `petForm()` builds a 5-card wizard from `profileGroups` (`assets/portal.js`): about, medical, dietary, emergency contacts, daily care. Fields are validated by `validatePetFields()` and saved as JSON in `pets.details` through `POST /api/pets`. |
| Availability | Weekly hours, buffer and date exceptions (`POST /api/schedule` and `/api/schedule-exception`; `upcomingWindows()`, `standingWindow()` and `bookableStarts()` in `lib/scheduling.mjs`), plus one-off windows (`POST /api/slots`). Starts fall on a 30-minute grid (`slotStep`). Tests: `tests/scheduling.test.mjs`, `tests/api.test.mjs`. |
| Booking with a hold | `bookingForm()` → `updateQuote()` → review via `POST /api/checkout-hold` (a 10-minute `checkout_holds` row), shown by `checkoutSummary()` → `POST /api/bookings` → status Requested, which customers see as "Waiting for Myomi". An ended hold is shown and recovered with fresh times (`expireHold()`, `reopenBooking()`); abandoned holds are released (`releaseHold()` on `pagehide`). Tests: `tests/browser/holds-smoke.mjs`. |
| Approval and visit lifecycle | `POST /api/status` (`lib/routes/bookings.mjs`). Approval re-checks `windowCovers()` and `conflict()`. Start is allowed from `earlyStartMinutes()`, which is the visit buffer (default 30), before the booked time (`startVisitForm()` in the UI). Completion requires a `summary`. Tests: `tests/early-start.test.mjs`. |
| Pet Diary | `POST /api/events` (staff): `kind` from `activityTypes`, `notes`, an optional photo stripped of metadata (`lib/image.mjs`, `lib/photos.mjs`) and stored in R2 under `events.photo_key`. `GET /api/diary` pages visits with their events, filtered by pet or visit. `GET /api/photos/:id` is owner-only. Rendered by `renderDiaryVisits()` (`assets/diary.js`). |
| Staff tools | `staffHome()`, `weekCalendar()` (7 days with hours and closed days), `adminSettings()` (hours, a date change, prices, extra windows, backup), financials based on booking prices (`GET /api/financials`, `showFinancials()`), history (`GET /api/history`). |
| Data safety | `GET /api/backup` and `scripts/restore.mjs` (`lib/backup.mjs`); safe retries (`lib/idempotency.mjs`); unsaved-form drafts (`assets/drafts.js`). |

### 1.3 Half-wired flows and dead ends
1. **Overnight pet sitting can't be booked as a real stay (🟡).**
   - `serviceNames` in `lib/domain.mjs` and the homepage "Pet Sitting" card offer it.
   - But `POST /api/services` caps `minutes` at 1,440, `POST /api/slots` caps windows at 24 hours, and `standingWindow()` opens and closes on the same day.
   - So an overnight fits only inside a hand-made window of 24 hours or less. Multi-night stays, nightly pricing and pickup times don't exist.
2. **Meet & greet is copy only (🟡).**
   - It's promised in `index.html` "How It Works" step 02, `myo/about/index.html` and `myo/safety_first_faq/index.html`.
   - There's no service, status or booking path for it.
3. **Payment is copy only (🟡).**
   - `checkoutSummary()` says "Online payment is currently unavailable".
   - `GET /api/financials` sums `bookings.cents`.
   - `Permissions-Policy` sets `payment=()` (`lib/headers.mjs`).
4. **Reviews are stubbed (🟡).**
   - `assets/review-links.js` has blank `write` and `read`, so `accountSettings()` hides the review link and the homepage button stays disabled.
   - Testimonials in `index.html` are labelled "Sample quotes and ratings".
5. **A customer reschedule of a confirmed visit silently un-confirms it (🟡).** `POST /api/reschedule` sets the status back to `Requested` for customers, and the UI only says "Saved."
6. **Vaccinations are free text** (`profileGroups` key `vaccinations`): no dates, no expiry, no gate (❌).
7. **Multi-pet bookings aren't priced (❌).** `bookingSelection()` accepts up to 12 pets, but `bookings.cents` is `service.cents`.
8. **There's no cancellation policy (❌).** A customer can cancel any future Requested or Confirmed booking at any time, at no cost (`POST /api/status`).
9. **Nothing is sent outside the portal (❌).** There's no email, SMS or push.
10. **The portal is English only (🟡).**
    - `portal/index.html`, `assets/portal.js` and `myo/client_journal_cute_lively/index.html` (the sample diary) contain no Spanish strings.
    - The homepage language choice isn't read by the portal.
11. **Profiles overwrite history (❌).** Editing `pets.details` changes what every past visit appears to have used.
12. **Staff have no customer list or private notes (❌).** Staff see only pets referenced by bookings (`petsFor()` in `lib/bookings.mjs`).

### 1.4 Test coverage
- **API and server:** 52 `node:test` cases across 10 files in `tests/`. They run on Node (`npm test`) and on the Worker runtime (`npm run test:worker`, which skips Node-only cases).
- **Browser:** two Chromium scripts run by `npm run test:browser`:
  - `tests/browser/portal-smoke.mjs`: the full customer and staff journey, drafts, a dropped connection, password change, backup download and paging.
  - `tests/browser/holds-smoke.mjs`: 19 checks covering hold expiry and recovery, abandoned holds, and the early-start button.
- **Usability evidence:** `docs/audits/2026-11-18-usability-test.md`.

---

## 2. Feature and flow matrix

### 2.1 Service catalog and pricing modifiers
| Capability | Our product | Rover | Wag! | Time To Pet |
|---|---|---|---|---|
| Duration tiers | ✅ `services(name, minutes, cents)`; several durations per name | 30 min + 60-min add-on | 20 / 30 / 60 min | Custom services and client rates |
| Multi-pet pricing | ❌ flat `service.cents` | Additional-pet add-on | Not covered | Automatic extra-pet fees |
| Extended care / late pickup | ❌ | +50% (2–8 h late), +100% (> 8 h) | +50% (3–6 h), +100% (6 h+) | Not covered |
| Automatic fee stacking (weekend, holiday, after-hours) | ❌ | Peak holiday rates | $29.99 rush fee within 3 h | ✅ Advanced Auto Fee Stacking |
| Overnight and multi-day | 🟡 one block of 24 h or less (§1.3.1) | Per-night boarding and house sitting | Sitting and boarding, 1 day to 3 months | Workaround arrival event (timer model breaks) |
| Recurring templates and projections | ❌ (weekly *hours* exist, recurring *bookings* don't) | Weekly walks, drop-ins, daycare | Weekly recurring | ✅ Repeat Templates + Projections |
| Cancellation policy | ❌ free at any time | Same-day, 1, 3 or 7 days, noon cutoff | Penalty-free if the walker is 30+ min late | Not covered |
| Prices before sign-in | ✅ `/api/catalog`, `/api/availability` | On search cards | At request | Portal |

### 2.2 Booking, onboarding and compliance
| Capability | Our product | Rover | Wag! | Time To Pet |
|---|---|---|---|---|
| Calendar and slots | ✅ hours, buffer, exceptions, extra windows; 30-min grid; 10-min hold with expiry recovery | Request with drop-off and pickup windows | ASAP or scheduled feed | Schedule blocks |
| Guided onboarding | 🟡 register → 5-step pet wizard; no agreement, no card | Pet profile | Profile, care and home access | ✅ wizard: e-sign, required fields, pets, card |
| E-signed agreements | ❌ | Not covered | Not covered | ✅ |
| Vaccine-gated booking | ❌ | Not covered | Not covered | ✅ red and orange flags, blocks requests |
| Meet & greet | 🟡 copy only | ✅ free, in-app | Optional $10 (sitting and boarding) | Not covered |
| Holds and billing | 🟡 10-min time hold, no payment | Charged upfront at confirmation | $1 pre-authorisation, charged on completion | Auto-charge or bulk invoices |
| Approval | ✅ Requested → Confirmed with re-checks | Sitter accepts | Algorithm or the owner picks | ✅ Approvals queue |
| Changes after confirming | 🟡 silent return to Requested | Sitter proposes, owner approves within 72 h | Not covered | Change requests on projected visits |

### 2.3 Home access, trust and safety
| Capability | Our product | Rover | Wag! | Time To Pet |
|---|---|---|---|---|
| Key custody and tracking | ❌ (the FAQ advises agreeing on a handover) | Not covered | Not covered | ✅ Master Key List, handoffs, "keys no longer needed" |
| Lockbox and entry notes | ❌ (the FAQ says share codes privately) | Not covered | ✅ encrypted notes revealed at start | Not covered |
| Vet and emergency contacts | 🟡 optional `vet`, `vetPhone`, `contact`, `contactPhone` in `pets.details`, shown to staff in `profileSummary()` | Pet profile | Care instructions | ✅ required custom fields |
| Health advisories and medication | 🟡 free text `health`, `medication`, `allergies`, `heartworm`; a "Medication" activity label | Pet profile | Care instructions | Feeding and medication tracking (Facility) |
| Policy and liability clarity | ❌ no terms or policy page | Guarantee (explicitly not insurance) | Guarantee, owner only | Agreements |
| Account and photo privacy | ✅ lockouts, device trust, owner-only photos without metadata | Not covered | Codes kept out of walker notes | Role-scoped staff views |

### 2.4 Live care telemetry and updates
| Capability | Our product | Rover | Wag! | Time To Pet |
|---|---|---|---|---|
| Walk, meal and potty logs | ✅ fixed `activityTypes` + free-text `notes`; time = `events.published` | Toggles | Toggles | Yes/No, count and choice fields |
| Custom report cards, hiding "No" answers | ❌ | ❌ | ❌ | ✅ (plus optional admin approval) |
| GPS | ❌ (`geolocation=()` in `lib/headers.mjs`) | ✅ route, time, distance | ✅ live map | ✅ check-in and route |
| Photos and video | ✅ one photo per event · ❌ video | Photo | Photo and video | Photo and video |
| Overnight residency updates | 🟡 events have no timer and span any booking length, but stays can't be booked | Photos | Not covered | Fragmented (timer flaw) |
| Door-locked checklist | ❌ | ❌ | ✅ mandatory, with an explanation if unlocked | ❌ |
| Visit summary | ✅ required to complete (`bookings.summary`) | Card note | Report card | Report card |
| Out-of-app delivery | ❌ (the diary refreshes on entry: `refreshDiaryView()`) | App | App | Email, feed, SMS |

### 2.5 After the stay and retention
| Capability | Our product | Rover | Wag! | Time To Pet |
|---|---|---|---|---|
| Care history | ✅ diary by visit (`/api/diary`) and booking history (`/api/history`) · ❌ per-pet timeline and profile versions | Thin (inbox and cards) | Not covered | Report history |
| Tipping | ❌ | After the stay | Before, during or after | One-time + Auto Tip |
| Reviews and quality signal | 🟡 Google links blank; sample testimonials | Double-blind reviews | Ratings | ✅ private Happiness Score |
| Rebooking | ❌ no "book again" | Repeat-client counts | Preferred caregivers | Templates |
| Export | ✅ staff backup (`lib/backup.mjs`) | Not covered | Not covered | Dropbox backup |

### 2.6 Operator and sitter workflow
| Capability | Our product | Rover | Wag! | Time To Pet |
|---|---|---|---|---|
| Schedule management | ✅ `adminSettings()`, `weekCalendar()`, approvals, reschedule, early-start rule | Calendar | Feed | ✅ Daily Summary |
| Invoicing and refunds | ❌ · 🟡 booking-price totals (`/api/financials`) | Escrow and payouts | Charged on completion | ✅ bulk invoicing; refunds don't update lines (flaw) |
| Packages | ❌ | Not covered | Not covered | Packages not linked to templates (flaw) |
| Guardrails against incomplete logs | 🟡 summary required; early start blocked; no checklist | Missing card holds payout | Report card required | Optional admin approval |
| Customer records | ❌ no list, no private notes | Inbox | Not covered | ✅ |
| Resilience (retries, drafts) | ✅ `lib/idempotency.mjs`, `assets/drafts.js` | Not covered | Not covered | Not covered |

---

## 3. Triage

### 3.1 Adopt or adapt
| Pattern | Source | Adaptation for a direct-to-client business |
|---|---|---|
| Vaccine records + booking gate | Time To Pet | Structured records with expiry and red/orange states. Block holds when a required vaccine is missing or expires before the stay ends. Add reminders once email exists (TTP lacks them). |
| Onboarding agreement | Time To Pet | One versioned service agreement in English and Spanish, accepted before the first request, with the accepted version recorded. |
| Key custody, sized for one sitter | Time To Pet | Per-household key label and status (with the client, with Myomi, returned), plus a "return keys" prompt when no visits are coming up. No office handoffs. |
| Home-access notes revealed at start | Wag! | Encrypted at rest. Shown to staff only for an In Progress visit or inside the early-start window, and every view is logged. |
| Door-locked confirmation | Wag! | Required at completion, with a note when not secured. Shown in the customer's diary. |
| Free meet & greet | Rover | A $0 booking type. Suggested to new clients; required before a first overnight. |
| Late-pickup rule | Rover / Wag! | One configurable surcharge for overnight stays, itemised in the quote. |
| One cancellation policy | Rover | A single cutoff per service type, not four marketplace tiers. |
| Extra-pet pricing | Time To Pet | A per-service extra-pet amount, itemised. |
| Private Happiness Score | Time To Pet | A three-button rating after each visit. No public two-sided reviews. |
| Recurring templates + projections | Time To Pet | Phase 3, built on the change-request and quote foundations. |

### 3.2 Metamorphose (our wedge)
1. **Overnight stays as first-class "residencies".**
   - The weaknesses: Time To Pet's timer model breaks on overnights, Rover's overnight photos are ephemeral, and Wag! is built for short dispatched visits.
   - What we already have: our diary is timer-free (`events` attach to any `bookings` row; `arrived` and `departed` are timestamps).
   - What to add: multi-night bookings with nightly pricing and expected check-ins (arrival, evening, morning, departure), rendered as one continuous stay thread.
2. **A longitudinal care record.**
   - The weakness: Rover and Wag! keep thin histories.
   - Add profile versions, snapshotted on each booking, and a per-pet timeline of visits, structured fields, medications, vaccines and profile changes.
   - Render it in the warm `renderDiaryVisits()` style rather than Time To Pet's accounting-style UI.
3. **One money ledger from day one.**
   - The weakness: Time To Pet's refunds don't update invoice lines, and its packages and templates aren't linked.
   - Make every charge, refund, credit, tip and package use a line on one ledger tied to `bookings`, and build the itemised quote (`booking_lines`) before payments.
4. **Report cards with presentation built in.** Time To Pet-style structured fields with "hide skipped answers", inside the existing diary design.
5. **Bilingual end to end.** None of the teardowns mention Spanish; our public site already has it. Extend it to the portal, agreements and messages.
6. **Reliability as a trust feature.** Holds, safe retries and drafts already beat the incumbents as described. Keep them as invariants for every new flow.

### 3.3 Intentionally skip
- **Marketplace matching:** bidding feeds and "Let Me Pick", algorithmic Quick Match, Star Sitter metrics, response and booking-rate scoring.
- **Marketplace money:** take rates, owner booking fees and rush fees as platform revenue, Wag! Pro or Premium, Instant Pay.
- **Two-sided public reviews and endorsement-gated onboarding.** Owner-to-Myomi feedback is enough. Notes about pets stay private to staff.
- **Team and enterprise features:** payroll, mileage, time off, roles, Geo Schedule map, automatic no-show cover, Facility tools (run cards, front desk, occupancy).
  - Revisit only if a second sitter joins.
  - A solo operator needs "Myomi unavailable" exceptions plus client notice instead.
- **Branded lockbox ordering and "guarantee" programmes.** Prefer plain policies and disclosure of actual insurance.
