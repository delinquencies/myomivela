# Claude UX architecture and logic plan

Prepared November 19, 2026 from the [flow audit](../ux-flow-audit.md), baseline `5d139ec`. All tasks below are unchecked implementation work.

## Reconciliation with Claude's architecture plan

Claude's complete CU0–CU8 text from `b89aa1f` is preserved in the appendix. The active execution IDs are CUX-01–CUX-09 below, with Codex's DUX tasks consuming their contracts.

| Claude original ticket | Active task(s) preserving its scope |
| --- | --- |
| CU0 booking state and route model | CUX-01/02 |
| CU1 public eligibility and quote | CUX-08 |
| CU2 guest-first contact/account | CUX-08 with CUX-02 |
| CU3 one intake with progressive save | CUX-03 |
| CU4 meeting scope and pending first request | CUX-02, subject to the policy decision below |
| CU5 deposit lifecycle | CUX-04 |
| CU6 cancellation terms and acknowledgment | CUX-04 |
| CU7 availability, capacity, notice and nights | CUX-09 |
| CU8 confirmation and client notification | CUX-05 |

**Ownership reconciliation.** The original CU plan assigned Claude unstyled markup and edits to `assets/portal.js`, `assets/care-portal.js`, `assets/price-sheet.js` and copy catalogs. Those integrations now belong exclusively to Codex under the path table in the Codex plan. Claude supplies pure controllers, data, API contracts and backend tests. The proposed `assets/booking-flow.js` export shape can be implemented within CUX-02's controller or renamed in its contract handoff; do not create a parallel state machine.

### Policy decisions to record before changing live behavior

| Question | Current configured/implemented behavior | Claude's proposed change | Required reconciliation |
| --- | --- | --- | --- |
| Meeting scope | A completed unused meeting is consumed per paid booking. | Once per client, with a new pet or 12-month renewal. | Confirm scope and renewal with Myomi. Preserve existing associations/history through any migration. |
| Request before meeting | A paid request is blocked until meeting completion. | Link a pending paid request and meeting before completion. | Confirm whether the desired care dates are reserved, and for how long, before meeting/approval/payment. |
| Deposit deadline trigger | Policy copy says within 48 hours of requesting; request ledger currently owes zero. | Start the 48 hours after owner acceptance. | Choose the trigger explicitly, including requests inside the service-start deadline, then align terms, state and tests. |
| Balance due | Current policy copy says before service begins. | Original CU5 says visit date/completion. | Confirm the deadline and permitted service-start behavior; do not infer completion as approval. |
| Cancellation | Launch policy uses seven days and retention of part of the deposit; runtime catalog model uses service settings. | Use launch deposit-based policy and retain catalog compatibility. | Confirm retention and grandfathering, record accepted terms on the booking. |
| Meeting notice | No explicit dedicated meeting-notice rule. | Minimum 24 hours. | Confirm operational minimum and meeting-before-service interval. |

These are proposed implementation decisions, not new approvals or features already shipped. A test flag may exercise an agreed proposal without making it the production default.

## Exclusive ownership

Claude owns backend rules, schema, route resolution, pure state controllers and draft serialization. Codex owns all DOM integration, HTML, CSS, human-facing EN/ES catalogs, public estimators' presentation and Playwright tests. The complete path allocation is in the [Codex plan](codex-ux-plan.md#exclusive-ownership-and-working-agreement).

Claude must not edit `assets/portal.js`, `assets/care-portal.js`, `assets/diary.js`, HTML shells, CSS, copy catalogs or browser tests for these tickets. Publish data contracts and pure modules instead. Codex wires the views after the contract lands. A necessary UI change discovered during a backend ticket becomes a handoff item for Codex.

New modules proposed here have no DOM rendering and no translated prose. Return stable route IDs, action IDs, reason codes, field keys and time/amount data. Codex translates and renders those results. Avoid a framework or a second independent state machine.

## CUX-01 — Canonical routes and role capabilities

- [ ] **Issues** UX-02, UX-08, UX-14, UX-17, UX-20.
- [ ] **Paths** Proposed `assets/portal-route-state.js`; authorization checks in `lib/api.mjs` and `lib/routes/staff.mjs` only if needed; public-module registration in `lib/site.mjs`; `tests/ux-routing.test.mjs`.
- [ ] Define one route descriptor registry with stable IDs, canonical locations, label keys, parent routes and allowed roles for signed-out, customer, owner and sitter states.
- [ ] Resolve existing hashes, legacy aliases, visit/client/pet identifiers and invalid/forbidden destinations deterministically. Separate route authorization from menu visibility. Keep supported deep links recoverable.
- [ ] Supply canonical routes for a selected visit, client record and bounded settings groups. Preserve browser history semantics and the booking return target. Do not manipulate the browser or render headings in this module.
- [ ] **Handoff contract** Publish functions equivalent to `routesFor(session)` and `resolveLocation(location, session)`, returning `{ id, params, parent, canonical, outcome }`. Enumerate `ready`, `sign_in_required`, `forbidden`, and `not_found` outcomes. Include legacy-link examples.
- [ ] **Acceptance** Customers have one Care details descriptor; owner/sitter sets exclude it. A sitter cannot access owner-only API resources. Invalid hashes produce an explicit result. Query service intent, visit/client IDs and Back/Forward history are preserved through canonicalization. Pure tests cover signed-out, all signed-in roles and invalid IDs.
- [ ] **Codex consumer** DUX-02 renders navigation and recovery; DUX-07 renders visit and settings destinations.

## CUX-02 — One booking-intent and prerequisite controller

- [ ] **Issues** UX-03, UX-05, UX-18.
- [ ] **Paths** Proposed `assets/booking-flow-state.js`; `lib/compliance.mjs`, `lib/routes/bookings.mjs`, `lib/routes/portal.mjs`, `lib/idempotency.mjs` if required; `tests/ux-booking-flow.test.mjs`.
- [ ] Model the selected service, attending pets and explicit primary pet, desired dates/times, quote revision, prerequisites, review hold and final request as one resumable task.
- [ ] Reuse current quote and blocker rules. Supply ordered prerequisites with stable task IDs, completion state, resolution destination and return intent. Distinguish customer information from a separately scheduled meeting.
- [ ] After the recorded meeting-policy decision, model linked pending care/meeting requests and expose a machine-readable meeting status. Define cancellation propagation, date reservations and transition guards so neither request can become accidentally confirmed. Preserve the original CU4 cases for new pets, renewal, meeting cancellation and meeting-too-late only when those rules are approved.
- [ ] Keep a desired time distinct from a reserved time. A prerequisite detour must not imply a hold. Revalidate availability and pricing when returning to review.
- [ ] Preserve nonsensitive selection across auth, language change, new-pet creation, care save and reload through CUX-03. Invalidate quote/hold only when its actual inputs or expiry change. Ignore stale async quote responses.
- [ ] **Handoff contract** Publish state equivalent to `{ intentId, revision, selection, steps, currentStep, blockers, quote, hold, resumeLocation, nextAction }`, and documented events for selection change, requirement completion, refresh, review, expiry, send and discard.
- [ ] **Acceptance** A first parent can resume after each requirement. A returning parent skips already-completed requirements according to the confirmed business policy. A stale quoted amount or taken time cannot submit. Double submits remain idempotent. Another customer's intent is never restored after sign-out.
- [ ] **Decision to expose** The current launch implementation consumes a completed Meet & Greet for each paid booking. Confirm with the owner whether that is intentional. Record the decision and migration impact. Codex must not silently convert it into a once-per-customer rule.
- [ ] **Codex consumer** DUX-04 supplies step UI and continuation; DUX-03 presents compact blocker/action states.

## CUX-03 — Canonical intake, safe drafts and structured errors

- [ ] **Issues** UX-04, UX-09, UX-19.
- [ ] **Paths** `assets/drafts.js`; `lib/routes/intake.mjs`, `lib/routes/bookings.mjs`, `lib/care.mjs`, `lib/validate.mjs`, `lib/headers.mjs`; append-only `lib/db.mjs` migrations if a verified data change is necessary; `tests/ux-intake.test.mjs`, `tests/ux-drafts.test.mjs`.
- [ ] Inventory overlapping fields in pet profile JSON, household intake and public intake. Define ownership, conditional requirements and explicit precedence. Reuse saved pet facts and household contacts without silently replacing a newer answer.
- [ ] Preserve old plain-text pet details and previous profile versions. Provide a migration/compatibility strategy only after that inventory establishes a real need.
- [ ] Extend draft form identity to care actions with stable owner/record IDs. Classify fields rather than persisting all care text blindly. Exclude passwords, entry codes, lockbox instructions, tokens, payment information and fields marked `data-no-draft`.
- [ ] Define whether emergency and medical details may be retained locally before implementing persistence. Use the smallest approved draft set; do not copy sensitive canonical records into browser storage by default. Support explicit discard and account-bound cleanup.
- [ ] Provide machine-readable validation errors in addition to existing messages, such as `{ code, fieldErrors: [{ field, code, params }] }`. Support partial save semantics only where operationally valid; an incomplete draft must not count as completed intake.
- [ ] **Handoff contract** Publish field keys, required conditions, saved/draft status, safe-draft allowlist and error payload examples. Keep markup attributes and visible wording with Codex.
- [ ] **Acceptance** Approved nonsensitive feeding draft survives reload; entry secrets do not appear in storage. Drafts clear on sign-out/account change/discard and expire under the documented policy. Save/validation failures retain recoverable values. Zero spending authorization is valid. Existing profile and intake data survive upgrades. Server blockers distinguish absent, incomplete and outdated records.
- [ ] **Codex consumer** DUX-05 renders grouped forms, completion and field errors. DUX-04 uses the completion state.

## CUX-04 — Financial and eligibility truth shared by every surface

- [ ] **Issues** UX-01, UX-15, UX-16.
- [ ] **Paths** `assets/myo-config.js`, `assets/myo-launch-backend.js`; `lib/pricing.mjs`, `lib/cancellation.mjs`, `lib/ledger.mjs`, `lib/payments.mjs`, `lib/outbox.mjs`, `lib/routes/bookings.mjs`, `lib/routes/payments.mjs`, `lib/routes/portal.mjs`; append-only `lib/db.mjs` migration when needed; `tests/ux-financial-flow.test.mjs`.
- [ ] First publish a discrepancy matrix for configured policy, estimator, quote, request, confirmation, ledger and cancellation. The observed policies promise 50% within 48 hours and a seven-day cancellation cutoff, while requested bookings currently owe zero and catalog cancellation defaults can differ.
- [ ] Define one authoritative quote/terms revision containing service units, line items, total, deposit due now, remaining balance, due/expiry times, cancellation schedule and payment capabilities. Both launch and catalog compatibility mode must have explicit semantics.
- [ ] Store the accepted terms revision/time on the request. A changed revision requires renewed acknowledgment before commit. Existing bookings retain their accepted financial terms.
- [ ] Implement the approved deposit lifecycle, or return a capability that prevents the UI from promising an unavailable step. An unconfigured live provider must yield a usable, explicit outcome. Test drivers may exercise the complete contract.
- [ ] Make deposit confirmation, approval, hold/availability, unpaid expiry, meeting association, cancellation and refunds consistent under retries and concurrent actions. Webhook truth is authoritative for paid state. Expiring one request must release only the allocations that belong to it.
- [ ] Make primary-pet ordering explicit in input and quote output. Retain selected-date peak/short-notice calculations and overnight nightly units. Expose service-area and manual-quote eligibility as data where used by the flow.
- [ ] **Owner decisions** Confirm per-booking meeting consumption, cancellation retention, unresolved configuration comments such as peak puppy amount and peak date range, and the payment/email provider setup. Preserve existing booked terms unless an approved, explicit repricing action applies.
- [ ] **Handoff contract** Document all financial states, transition triggers, amount fields in cents, deadlines with timezone rules, capability flags, idempotency behavior and error codes. Do not supply a separate UI-only price calculator.
- [ ] **Acceptance** With a test provider, a request follows the approved deposit/approval order, webhook replay cannot double-charge or double-credit, unpaid expiry runs once, refunds reconcile, and cancel-preview values match the stored terms. Changing current service settings cannot silently rewrite an earlier booking's cancellation terms. Concurrency tests cover expiry versus payment/approval. Node and Worker agree.
- [ ] **Codex consumer** DUX-06 renders review, estimator wording, deposit deadlines, unavailable-payment states and cancellation truth.

## CUX-05 — Visit state and actionable dashboard summaries

- [ ] **Issues** UX-07, UX-08, UX-17.
- [ ] **Paths** Proposed `assets/visit-state.js`; `lib/bookings.mjs`, `lib/routes/portal.mjs`, `lib/routes/clients.mjs`, `lib/routes/diary.mjs`, `lib/routes/access.mjs`, `lib/routes/bookings.mjs`; `tests/ux-visit-state.test.mjs`.
- [ ] Derive customer current care, latest update, next booking, outstanding actions and staff priority work from existing bookings rather than duplicating business state in several views.
- [ ] Supply a stable selected-visit resource/action descriptor, compatible with CUX-01. Include permitted next actions, relevant pets, latest event, financial state and client/profile links.
- [ ] Preserve CU8's explicit confirmation contract. Request responses and the access-checked booking resource expose ordered `next_steps`, request reference, timeline and authoritative meeting/deposit deadlines. Queue client receipt and relevant deposit/meeting notifications through the outbox, exposing delivery capability truthfully.
- [ ] Reuse the current start/completion guards, owner/sitter authorization and home-entry reveal window. Operational actions must retain visit identity across publish and refresh.
- [ ] Put availability/pricing/policy/team/money/backup route capabilities in CUX-01. This task supplies resource/action data, leaving layout and grouping to Codex.
- [ ] **Handoff contract** Publish DTOs equivalent to `{ activeCare, latestUpdate, nextActions, workQueue }` and a selected-visit state with `allowedActions`, freshness/revision and relevant links.
- [ ] **Confirmation acceptance** A sent request can be reopened by its owner through a stable route and gives the same next actions after reload. A customer cannot read another customer's confirmation. Replayed writes queue each client notification once. The response distinguishes queued/delivered/unavailable notification state.
- [ ] **Acceptance** Two simultaneous active visits cannot receive each other's notes or photos. Owner can approve/cancel; sitter can perform only authorized operational actions. Customer sees only their own care and finances. Stale completion/update requests fail consistently. Summary counts match underlying records and pagination handles more than one page of work.
- [ ] **Codex consumer** DUX-07 builds active-care summaries, due-work lists and the visit workspace.

## CUX-06 — Bounded diary freshness and request lifecycle

- [ ] **Issues** UX-10, UX-13 and async route recovery.
- [ ] **Paths** Proposed `assets/diary-sync.js`; `lib/routes/diary.mjs`, `lib/routes/portal.mjs`, `lib/bookings.mjs`; `tests/ux-diary-sync.test.mjs`.
- [ ] Define an update revision/cursor and a lightweight reconciliation strategy. Reuse paginated diary reads where possible. Avoid repeatedly fetching unrelated account/configuration data for an open diary.
- [ ] Start refresh only while a relevant screen is visible. Stop on sign-out, account change, hidden tab and route disposal. Coalesce overlapping reads, ignore responses from an earlier user/route generation, and apply bounded backoff.
- [ ] Propose a visible-screen freshness budget, for example 30 seconds, document its request cost and make it a configurable contract. This is a proposed product budget, not a measured production SLA.
- [ ] Distinguish idle/current, checking, new data, stale and disconnected outcomes. Preserve loaded pages and filters; return merge information rather than replacing the entire portal.
- [ ] **Handoff contract** Publish start/stop/refresh and subscription callbacks with `revision`, `checkedAt`, `latestPublishedAt`, `state` and incremental results. No DOM, announcements or scroll operations in this module.
- [ ] **Acceptance** A new staff update is discoverable within the chosen visible-screen budget. Hidden tabs do not poll. Retry delays are bounded, navigation cancels/discards old responses, and switching accounts never merges data. Older-page/filter selections survive refresh. Document expected Worker requests per active client.
- [ ] **Codex consumer** DUX-08 renders freshness and retry UI. DUX-10 validates the observed update path.

## CUX-07 — Account recovery capability

- [ ] **Issue** UX-22.
- [ ] **Paths** `lib/auth.mjs`, `lib/routes/account.mjs`, `lib/outbox.mjs`, `lib/config.mjs`; append-only `lib/db.mjs` migration if necessary; `tests/ux-account-recovery.test.mjs`.
- [ ] Define whether self-service recovery can be delivered with the configured email driver. Return a capability so the UI can present a truthful alternative while delivery is unavailable.
- [ ] Implement request/redeem recovery with short-lived, single-use tokens stored as hashes, account/IP rate limits, generic account-discovery-safe responses and appropriate session invalidation after reset.
- [ ] Use existing account/password validation and outbox delivery boundaries. No token value belongs in an API log, browser draft or human-facing plan.
- [ ] **Handoff contract** Publish request and redeem endpoints, validation/error codes, delivery capability, expiry behavior and account-session effects.
- [ ] **Acceptance** Existing and unknown emails receive the same public request response. Expired/replayed tokens fail, concurrent redemption succeeds once, reset enforces password rules, and compromised sessions are handled according to the published policy. Test delivery failure explicitly.
- [ ] **Codex consumer** DUX-08 adds recovery entry/form and statuses after capability is available.

## CUX-08 — Guest quote, service area and contact contract

- [ ] **Issues** UX-26, UX-27. Preserves Claude CU1/2.
- [ ] **Paths** Proposed `lib/service-area.mjs` and `lib/routes/public.mjs`; `lib/pricing.mjs`, `lib/routes/bookings.mjs`, `lib/routes/account.mjs`, `lib/routes/intake.mjs`, `lib/config.mjs`, `assets/myo-config.js`; CUX-02's pure intent controller; append-only `lib/db.mjs` migration if required; `tests/ux-public-booking.test.mjs`.
- [ ] Reuse server pricing for a public quote accepting provisional species/age/count and service/date data. It creates no hold or booking and returns no customer-specific records or blockers. Rate-limit and bound inputs.
- [ ] Supply a public eligibility result for a ZIP/location with an explicit confidence/manual-review outcome. If ZIP-centroid data is used, preserve source/date and acknowledge boundary uncertainty. Collect a structured service address and client phone at the account/contact step and recheck actual eligibility according to an approved area rule.
- [ ] Revalidate the guest estimate against authenticated pet records before creating a hold or request. Keep intent through register, email-already-exists, sign-in and a time becoming unavailable.
- [ ] Coordinate client phone/address field ownership with CUX-03. Keep legacy registration valid for existing callers or provide a documented compatibility path. Do not require an unconfigured email-link login as the only way to continue.
- [ ] **Handoff contract** Document endpoints equivalent to `GET /api/eligibility?zip=` and `POST /api/public-quote`, quote revision/units/expiry semantics, supported contact fields, area confidence and machine-readable failure codes. Use CUX-04 financial fields and CUX-09 day/night metadata.
- [ ] **Acceptance** A signed-out visitor can see a real-date estimate without account creation. Unknown/boundary ZIPs receive an explicit review outcome. Malformed/out-of-area inputs are handled according to the approved service-area policy. The guest and signed-in quotes match for equivalent facts, and a changed actual price requires review. No public response leaks client, pet or sensitive occupancy information.
- [ ] **Codex consumer** DUX-11 renders eligibility/guest preview; DUX-04 integrates account continuation.

## CUX-09 — Availability metadata and predictable defaults

- [ ] **Issues** UX-15, UX-16, UX-28. Preserves Claude CU7.
- [ ] **Paths** `lib/scheduling.mjs::bookableStarts()/overnightNights()`, `lib/pricing.mjs`, `lib/routes/portal.mjs`, `lib/routes/bookings.mjs`, `assets/myo-config.js`, CUX-02's selection controller; `tests/ux-availability.test.mjs`.
- [ ] Supply day metadata for capacity, peak period, short notice and next eligible start, together with next available overnight nights. Use the same capacity and timezone calculations as quote/confirmation.
- [ ] Define a server-backed default to a notice-free eligible day when available. Keep short-notice choices available when allowed, with surcharge metadata. Never replace an explicit restored date silently. If no notice-free day exists, expose that fact and the available alternatives.
- [ ] Exclude or label full days consistently and recheck capacity at hold/confirmation under concurrency. Enforce the owner-approved meeting-notice rule at quote, hold and request.
- [ ] **Handoff contract** Publish `days:[{ date, full, peak, last_minute, first_start }]`, `overnight_nights`, notice-free threshold, service units and distinct unavailable/notice error codes. Maintain existing API callers through additive fields or a versioned transition.
- [ ] **Acceptance** Seed a full day and peak day; availability agrees with quote rejection and shows the next valid alternative. Overnight availability never depends on visit-grid start times. Default selection avoids a short-notice charge when a valid fee-free alternative exists. Restored dates remain explicit choices. Node and Worker tests cover Massachusetts day boundaries, DST and concurrent capacity changes.
- [ ] **Codex consumer** DUX-03/06 render chips, short lists and stay units; DUX-11 uses metadata in guest discovery.

## Merge and handoff sequence

1. CUX-01 and CUX-02 can begin after recording shared route/intent IDs. Keep each implementation in its assigned modules.
2. CUX-03 establishes field/draft classification before DUX-05 integrates persistence. CUX-04 resolves policy truth before DUX-06 promises financial steps.
3. CUX-05 builds on CUX-01 IDs. CUX-06 can progress independently using the existing diary API. CUX-07 depends on an actual delivery decision for a live launch.
4. CUX-08/09 share CUX-02 intent and CUX-04 pricing semantics. They unblock DUX-11, public preview and short-notice/capacity presentation. CUX-05 confirmation data unblocks DUX-12.
5. For every ticket, publish contract examples and fixture setup in this plan or a linked backend contract note, run relevant Node/Worker tests, and report the commit to Codex. Codex owns UI integration and all Playwright regressions.

Do not mark an end-to-end issue complete solely because its API exists. Completion requires the corresponding Codex acceptance criteria and the combined customer/admin journey to pass.

---

## Preserved Claude source from b89aa1f

The original November 19 document is retained below for attribution, evidence, and continuity of its issue and ticket IDs. The reconciled sections above are the active execution plan. Proposed policy defaults and UI ownership in this source are subject to the reconciliation above.

<details>
<summary>Read Claude's complete original document</summary>

<!-- claude-source-b89aa1f-start -->
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

<!-- claude-source-b89aa1f-end -->

</details>
