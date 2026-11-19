# Claude UX architecture and logic plan

Prepared November 19, 2026 from the [flow audit](../ux-flow-audit.md), baseline `5d139ec`. All tasks below are unchecked implementation work.

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
- [ ] Reuse the current start/completion guards, owner/sitter authorization and home-entry reveal window. Operational actions must retain visit identity across publish and refresh.
- [ ] Put availability/pricing/policy/team/money/backup route capabilities in CUX-01. This task supplies resource/action data, leaving layout and grouping to Codex.
- [ ] **Handoff contract** Publish DTOs equivalent to `{ activeCare, latestUpdate, nextActions, workQueue }` and a selected-visit state with `allowedActions`, freshness/revision and relevant links.
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

## Merge and handoff sequence

1. CUX-01 and CUX-02 can begin after recording shared route/intent IDs. Keep each implementation in its assigned modules.
2. CUX-03 establishes field/draft classification before DUX-05 integrates persistence. CUX-04 resolves policy truth before DUX-06 promises financial steps.
3. CUX-05 builds on CUX-01 IDs. CUX-06 can progress independently using the existing diary API. CUX-07 depends on an actual delivery decision for a live launch.
4. For every ticket, publish contract examples and fixture setup in this plan or a linked backend contract note, run relevant Node/Worker tests, and report the commit to Codex. Codex owns UI integration and all Playwright regressions.

Do not mark an end-to-end issue complete solely because its API exists. Completion requires the corresponding Codex acceptance criteria and the combined customer/admin journey to pass.
