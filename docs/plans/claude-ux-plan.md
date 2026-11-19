# Claude UX plan: flow architecture and booking logic

**Source:** [docs/ux-flow-audit.md](../ux-flow-audit.md) (November 19, 2026, `main` at `5d139ec`). Issue numbers below (#1–#20) refer to its table.

**Scope:** server rules, data model, API contracts, flow routing and state. Claude builds each step with *functional, unstyled* markup only, so the flow works and is testable end to end. Visual design, copy polish, progress indicator styling, responsive layout, accessibility refinements and the Playwright regression suite belong to [codex-ux-plan.md](codex-ux-plan.md). Nothing here is styled; nothing there changes a rule.

**Order:** CU0 → CU1 → CU2 → CU3 → CU4 → CU5 → CU6 → CU7 → CU8. Each step ends with a **Handoff to Codex** contract. Codex starts a ticket once its listed CU steps are merged.

**Decisions needed from Myomi before CU4–CU6 ship** (defaults are implemented behind `assets/myo-config.js` flags, so a decision is a one-line change):

| Decision | Default built | Flag |
|---|---|---|
| Meet & Greet once per client, or before every booking (as the policy says today) | Once per client, again for a new pet or after 12 months | `booking.meetScope: 'client' \| 'booking'` |
| May the first visit be requested *before* the Meet & Greet happens? | Yes, held as "Pending Meet & Greet"; Myomi confirms after meeting | `booking.requestBeforeMeet: true` |
| When is the 50% deposit due? | Within 48 h of Myomi accepting the request | `booking.depositHours: 48` (exists) |
| Cancellation | 7+ days: deposit refunded; under 7 days: keep 50% of the deposit | `booking.cancellationDays`, `flags.lateCancellationDepositRetentionRatio` (exist) |
| Minimum notice for a Meet & Greet | 24 hours | `booking.meetNoticeHours: 24` |

## CU0: One booking-flow state and route model
**Fixes:** structural cause of #5, #8, #9. **Files:** new `assets/booking-flow.js`; `assets/portal.js` (`render()`, `showSection()`, `bookingForm()`, submit handler); `portal/index.html`.

**Design**
- The booking funnel moves out of the dashboard into its own route family: `#book/service` → `#book/details` → `#book/intake/1|2|3` → `#book/review` → `#book/done/<id>`. The dashboard's **Book a visit** tile and the landing CTAs deep-link into `#book/service`. Existing `#book` and `?service=…#book` links redirect to `#book/service` with the service preselected.
- `assets/booking-flow.js` owns a single `flow` object `{ step, service, pets[], start | {arrive, depart}, zip, contact, intakeStep, quote, hold, termsVersion, accepted }`, persisted in `sessionStorage` (`myo-flow`) so a reload, a language switch or Back resumes the same step. It replaces the ad hoc reads of the booking form's DOM in the submit handler.
- `next()`, `back()` and `goTo(step)` validate the current step through the API contracts below and never let the user skip a required step. Browser Back moves one step back (each step pushes a history entry); the hold is kept until it expires.
- Signed-in clients with a complete intake skip `#book/intake/*`; returning clients go service → details → review.

**Edge cases:** a language switch mid-flow re-renders the step from `flow` (no re-query). A hold that expires while on review returns to `#book/details` with the chosen day kept (reuses `expireHold()`). Sign-out clears `myo-flow`.

**Handoff to Codex:** `import { flow, steps, currentStep, next, back } from './booking-flow.js'`. `steps` is `[{ id:'service'|'details'|'intake'|'review'|'done', label, done:boolean, current:boolean, substeps? }]` for the progress indicator. Each step renders inside `<section data-flow-step="<id>">` with one `<form data-flow-form>` and one primary submit button `[data-flow-primary]`. Errors go in `[data-flow-error] role="alert"`.

## CU1: Public eligibility and quote (no account)
**Fixes:** #4 (radius), #5, #11. **Files:** new `lib/service-area.mjs`, new `lib/routes/public.mjs`; `lib/pricing.mjs`; `lib/routes/bookings.mjs` (reuse `bookingSelection()` pieces); `assets/myo-config.js`.

**Design**
- **Service area:** `lib/service-area.mjs` holds a static list of ZIP codes within 15 miles of 01108 (Springfield), generated once from public ZIP centroids and committed with its source date. No external geocoding call at runtime. `eligibility(zip)` returns `{ eligible, zip, distance_miles, reason?:'outside_area'|'unknown_zip' }`. Ambiguous edges ("unknown_zip") are allowed with a note that Myomi will confirm.
- **`GET /api/eligibility?zip=`** (public, rate-limited like login): the result above.
- **`POST /api/public-quote`** (public, rate-limited): `{ service, pets:[{ kind:'dog'|'cat'|'exotic', age_years? }], slot, start }` or `{ service, pets, arrive, depart }`, plus optional `zip`. Same pricing path as `/api/quote` (`priceBooking()` in launch mode, which already reads species and age), without user-specific blockers. Returns the quote contract below. No hold is created.
- `/api/quote` (signed in) returns the same shape plus `blockers`.

**Quote contract** (both endpoints):
```js
{ starts, ends, lines:[{ code, label, quantity, cents }], total_cents,
  deposit_cents, balance_cents, deposit_due_hours:48,
  notice:{ last_minute:boolean, fee_free_from:'YYYY-MM-DD' },
  peak:{ is_peak:boolean, period?:string },
  terms:{ version, cancellation_days, late_retention_ratio, summary_key:'terms.standard' },
  eligibility?:{ eligible, distance_miles, reason? } }
```
**Edge cases:** pets given by kind only (no pet records) for guests; a guest quote is re-priced from real pet records at hold time, and a difference returns 409 `price_changed` as today. Requests with more than 12 pets or a past start are refused (400).

**Handoff to Codex:** the two endpoints and the quote contract above; error codes `outside_area`, `unknown_zip` (with Spanish and English messages added in `assets/i18n.js`).

## CU2: Guest-first flow with the account at step 3
**Fixes:** #5. **Files:** `assets/booking-flow.js`, `assets/portal.js` (`auth()`), `lib/routes/account.mjs`, `lib/routes/bookings.mjs`.

**Design**
- Steps 1–2 (`#book/service`, `#book/details`) work signed out using CU1. The first contact screen is **step 3a: "About you"**: name, email, phone, home address and ZIP (eligibility re-checked), and a password (until email exists, see below). Submitting registers and signs in (`POST /api/register` gains `phone`, `address`, `zip`; stored on `users`, migration 28), then immediately creates the time hold from `flow` (`POST /api/checkout-hold`).
- Existing clients choose "I have an account" on 3a and sign in; the flow continues with `flow` intact.
- The `auth()` sign-in page remains for `#upcoming`, `#diary` and the rest of the portal, not for booking.
- When an email provider is connected, 3a drops the password in favour of a sign-in link. The contract below is unchanged.

**Edge cases:** the chosen time is taken between step 2 and 3a, so the hold fails with 409 and the flow returns to `#book/details` with the message and the same day selected. Email already registered: 409 `email_taken`, the flow offers sign-in in place without losing `flow`.

**Handoff to Codex:** `POST /api/register { name, email, password, phone, address, zip }` → session user with `phone`, `address`, `zip`, `eligible`. Errors: `email_taken`, `outside_area`, `invalid_phone`.

## CU3: One intake, three steps, saved per step
**Fixes:** #8, #4. **Files:** `lib/routes/intake.mjs`, `lib/db.mjs` (migration 28), `assets/myo-config.js` (`intakeFields` → `intakeSteps`), `assets/portal.js` (`profileGroups`, `petForm()`), `assets/care-portal.js` (`careSettings()`).

**Design**
- **Single source of truth.** Structured pet facts live on the pet (name, species, breed, sex, birthday/age, weight). Care and emergency facts live in `care_intakes`. The duplicated pet-profile fields (health, medication, allergies, vaccinations, food, feeding, vet, emergency contact, behavior) move into the intake. A migration copies any values from `pets.details` JSON into the owner's intake where the intake field is empty, keeping the original text.
- **Three steps** (`myoConfig.intakeSteps`):
  1. *About you & home*: phone, address/ZIP (from CU2), home-access method (vault, existing `lib/routes/access.mjs`).
  2. *Your pet(s)*: one card per pet (name, species, age, weight) plus feeding, health/allergies, medication, behavior, vaccines (existing vaccine records in `lib/routes/compliance.mjs` linked, not retyped).
  3. *Vet & emergency*: vet, emergency contact, decision makers, vet authorization, spending limit, overnight acknowledgment when an overnight is in the flow.
- **`POST /api/intake/step { step:1|2|3, data }`** validates and saves one step; **`GET /api/intake`** returns `{ steps:[{ step, complete, missing:[field] }], complete }`. `blockers()` in `lib/compliance.mjs` uses `complete` instead of "a saved body exists".
- The public intake form on `/myo/launch/#intake` is retired (its route is replaced by a link into `#book/intake/1`); `lib/routes/intake.mjs` keeps accepting the old whole-body POST for one release, mapped onto the steps.

**Edge cases:** 0 is a valid spending limit (keep). Overnight acknowledgment is required only when the flow or a booking includes an overnight. A client with two pets saves step 2 with both cards at once.

**Handoff to Codex:** `GET /api/intake` and `POST /api/intake/step` as above; `myoConfig.intakeSteps = [{ id, titleKey, fields:[{ name, type, required, maxLength, helpKey }] }]` drives rendering. Missing fields come back as `{ code:'intake_incomplete', missing:[name] }` with 400.

## CU4: Meet & Greet once per client, alongside the first request
**Fixes:** #1, #14. **Files:** `lib/compliance.mjs` (`availableMeet`, `blockers`), `lib/routes/bookings.mjs` (`/api/bookings`, `/api/status`), `lib/db.mjs` (migration 28), `assets/myo-config.js`, `assets/myo-copy.js` (`meetBody`), `assets/care-copy.js`.

**Design**
- **Scope:** with `meetScope:'client'`, `meet_required` applies only when the client has no completed Meet & Greet, a pet in the request has not met Myomi, or the last one is more than 12 months old. `bookings.meet_booking` remains as a record of which meeting covered a booking, not a consumable.
- **Request before meeting:** with `requestBeforeMeet:true`, a first-time client's flow books both at once. Review shows the Meet & Greet time and the visit time. `POST /api/bookings` accepts `meet:{ slot, start }` and creates the Meet & Greet (Requested) and the visit with a new status **`Pending Meet & Greet`**, linked by `meet_booking`. The visit cannot be confirmed (`/api/status` Confirmed returns 409 `meet_pending`) until the Meet & Greet is Completed; completing it moves the visit to `Requested` for Myomi's decision and notifies her.
- Cancelling the Meet & Greet cancels the pending visit (with no fee), and the client is told.
- `GET /api/portal` gives customers `meet_status:'needed'|'scheduled'|'done'` instead of the client inferring it.
- Policy copy (`meetBody` in `assets/myo-copy.js`, EN and ES) changes to "Your first booking starts with a free Meet & Greet…". Claude changes the wording of rules; Codex owns tone and layout.

**Edge cases:** an overnight requested before meeting needs the Meet & Greet at least 24 h before arrival (409 `meet_too_late`). Capacity counts the pending visit only once it is Requested.

**Handoff to Codex:** status `Pending Meet & Greet` in bookings (add `status.Pending Meet & Greet` to both catalogs); `meet_status` in portal data; request payload `meet:{ slot, start }`; errors `meet_pending`, `meet_too_late`.

## CU5: 50% deposit with a 48-hour window
**Fixes:** #2. **Files:** `lib/routes/bookings.mjs` (`/api/status`), `lib/routes/payments.mjs`, `lib/ledger.mjs`, `lib/outbox.mjs`, `worker.mjs` (alarm), `server.mjs` (timer), `lib/db.mjs` (migration 28: `bookings.deposit_cents`, `bookings.deposit_due_at`), `assets/myo-launch-backend.js` (`beginDepositCheckout` removed).

**Design**
- Requests stay free to send. When Myomi **accepts** a request, the booking becomes **`Awaiting deposit`** with `deposit_cents = round(total × depositRatio)` and `deposit_due_at = now + depositHours`. The time stays reserved.
- **Pay:** `POST /api/payments/start { booking, part:'deposit'|'balance' }`. With Stripe on, a hosted checkout for the deposit; the signed webhook records it and moves the booking to `Confirmed`. With Stripe off, Myomi records the deposit by hand (`POST /api/payments/record`), which also confirms.
- **Expiry:** the outbox drain timer (Node) and Durable Object alarm (Worker) call `expireDeposits(now)`: unpaid `Awaiting deposit` bookings past `deposit_due_at` become `Cancelled` with `cancel_reason:'deposit_expired'`, releasing the time, and the client is notified. Reminders queue at 24 h and 4 h before expiry.
- **Balance:** due on the visit date (completion), shown as `balance_cents`. Tips stay as before.
- `paymentSummary()` gains `deposit_cents`, `deposit_paid:boolean`, `deposit_due_at`.

**Edge cases:** a deposit paid after expiry (late webhook) is recorded and refunded automatically if the time was released and retaken; if still free, the booking is reinstated. A $0 booking (Meet & Greet) skips the deposit and goes straight to Confirmed. Reschedules keep the paid deposit; a price increase adds to the balance, not the deposit.

**Handoff to Codex:** statuses `Awaiting deposit` (both catalogs); booking `payment.{ deposit_cents, deposit_paid, deposit_due_at, balance_cents }`; `POST /api/payments/start { booking, part }`; quote fields `deposit_cents`, `balance_cents`, `deposit_due_hours` (CU1).

## CU6: One cancellation policy, shown and acknowledged at review
**Fixes:** #3. **Files:** `lib/cancellation.mjs`, `assets/policy-copy.js`, `assets/myo-config.js`, `lib/routes/bookings.mjs`, `lib/db.mjs` (migration 28: `bookings.terms_version`, `bookings.terms_accepted_at`).

**Design**
- In launch mode the deposit-based policy in `myo-config.js` is the only one: cancel 7+ days before, full deposit back; under 7 days, keep `lateCancellationDepositRetentionRatio` of the deposit; Myomi cancelling refunds everything. The per-service percentage (C3.2) stays for catalog mode only. `cancellationTerms()` returns both the computed fee and the plain-language **summary key**, so the same text appears at review and in the cancel dialog.
- **Acknowledgment:** `POST /api/bookings` requires `accept_terms_version` equal to the current terms version (409 `terms_changed` with the new summary otherwise) and stores it on the booking. The separate service agreement stays a one-time blocker, but it is surfaced *inside* the review step (CU0) instead of on Care details.

**Edge cases:** terms text changes mid-flow → 409 and review re-renders. Late cancellation of an unpaid `Awaiting deposit` booking has no fee.

**Handoff to Codex:** quote `terms:{ version, summary_key, cancellation_days, late_retention_ratio }`; `terms.standard` text in both catalogs with placeholders `{days}`, `{percent}`; request field `accept_terms_version`; error `terms_changed`.

## CU7: Smarter availability and defaults
**Fixes:** #6, #7, #13, #15. **Files:** `lib/scheduling.mjs` (`bookableStarts`, `overnightNights`), `lib/routes/portal.mjs` (`/api/availability`), `lib/pricing.mjs`, `assets/price-sheet.js` data only.

**Design**
- `/api/availability` and portal `slots` gain per-day metadata: `days:[{ date, full:boolean, peak:boolean, last_minute:boolean, first_start }]`. Full days (capacity reached) are excluded from `slots`.
- Overnights return their next available nights (`overnight_nights`) in `/api/availability` so the price sheet can say "next available night: …".
- The flow's default day is the first day where `last_minute` is false; the earliest day is still selectable with its fee shown.
- Meet & Greet starts must be at least `meetNoticeHours` ahead (400 `meet_too_soon` from quote and hold).

**Handoff to Codex:** the `days` array above; `overnight_nights` in `/api/availability`; error `meet_too_soon`.

## CU8: Confirmation contract and client messages
**Fixes:** #9. **Files:** `lib/routes/bookings.mjs`, `lib/outbox.mjs` (templates), `lib/routes/portal.mjs`.

**Design**
- `POST /api/bookings` returns `{ id, status, next_steps:[{ code, due_at?, href }] }` with codes in order: `meet_scheduled`, `intake_incomplete`, `awaiting_review`, `deposit_after_acceptance`, `updates_in_diary`.
- `GET /api/bookings/:id` (owner or staff) returns the booking with `timeline:[{ status, at, done }]` (Requested → Accepted → Deposit paid → Visit → Completed).
- New outbox templates for the client: `request_received_client`, `deposit_due`, `deposit_reminder`, `deposit_expired`, `meet_completed_next_step`, in English and Spanish. They queue now and send once an email driver exists.

**Handoff to Codex:** `next_steps` codes (each with an `next.<code>` catalog key in both languages) and the `timeline` shape for `#book/done/<id>` and booking cards.

## Verification for every CU step
Node and Worker API tests for each new rule (`tests/flow-*.test.mjs`): radius in/out/unknown, public quote parity with the signed-in quote, per-step intake completeness, Meet & Greet scope and pending visits, deposit expiry and late webhooks, terms acknowledgment, full-day exclusion, `next_steps` order. Spanish and English messages for every new error code (enforced by `tests/i18n.test.mjs`). Claude adds no browser tests; the end-to-end suite is Codex X-U11.
