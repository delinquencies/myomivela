# Codex UX remediation plan

Prepared November 19, 2026 from the [flow audit](../ux-flow-audit.md), baseline `5d139ec`. Implementation status is recorded in the active checklists below. The audit baseline remains documentation-only.

## Reconciliation with Claude's UI plan

Claude's complete X-U1–X-U12 plan from `b89aa1f` is preserved in the appendix. The active execution IDs are DUX-01–DUX-12. Use the exclusive ownership below for all implementation. Claude's original proposal to supply unstyled step markup is replaced by a pure route/state contract; Codex owns that markup and its integration.

| Claude original ticket | Active task(s) preserving its scope |
| --- | --- |
| X-U1 hero, price, service area and How It Works | DUX-11; financial wording in DUX-06 |
| X-U2 price sheet/nightly labels | DUX-06, with CUX-09 availability metadata |
| X-U3 mobile dock and shorter time lists | DUX-03 |
| X-U4 peak/notice/full day chips | DUX-03/06, after CUX-09 |
| X-U5 progressive intake and duplicate retirement | DUX-05, after CUX-03 |
| X-U6 progress/loading/error | DUX-04/08 |
| X-U7 review/deposit/terms | DUX-06, after approved CUX-04 financial semantics |
| X-U8 confirmation and next steps | DUX-12 |
| X-U9 client home and menu | DUX-01/07 |
| X-U10 touch/focus/contrast | DUX-01/03 |
| X-U11 direct-booking E2E | DUX-10 |
| X-U12 bilingual copy | DUX-09 |

Keep Claude's proposed guest-first journey and short returning-client path as implementation goals. Exact meeting/deposit order follows recorded owner decisions. Text wrapping is judged by readability and operability rather than a blanket ban on three-line Spanish labels.

## Exclusive ownership and working agreement

Codex owns the DOM, layouts, CSS, human-facing copy, browser interaction integration, and Playwright tests. Claude owns routing/state logic, draft serialization, schema, API, authorization, and financial rules under the [Claude plan](claude-ux-plan.md).

| Codex writes | Claude writes |
| --- | --- |
| `index.html`, `myo/about/index.html`, `myo/safety_first_faq/index.html`, `myo/client_journal_cute_lively/index.html`, `myo/launch/index.html`, `portal/index.html` | `lib/**/*.mjs`, `worker.mjs` and `server.mjs` when required by a backend contract |
| `assets/portal.js`, `assets/care-portal.js`, `assets/diary.js`, `assets/home.js`, `assets/myo-launch.js`, `assets/price-sheet.js`, `assets/public-i18n.js` | `assets/drafts.js`, `assets/myo-config.js`, `assets/myo-launch-backend.js` |
| `assets/home.css`, `assets/portal.css`, `assets/myo-launch.css` | Proposed new pure modules `assets/portal-route-state.js`, `assets/booking-flow-state.js`, `assets/visit-state.js`, `assets/diary-sync.js` |
| `assets/i18n.js`, `assets/ui-copy.js`, `assets/care-copy.js`, `assets/myo-copy.js`, `assets/policy-copy.js` | `tests/*.test.mjs` for backend, routing, serialization and pure-state behavior |
| `tests/browser/*.mjs`, browser command integration in `package.json` | `tests/helpers.mjs` and API/test-fixture support |

This allocation applies to implementation after this audit. Claude publishes machine-readable outcomes and data contracts without editing existing UI files. Codex imports those contracts, renders them, and routes UI events through them. Claude owns registration of new pure modules in `lib/site.mjs`; Codex registers no alternate server logic. Proposed module names can be revised in the handoff before either agent starts that task.

Codex does not recreate price math, authorization, prerequisite rules, token handling, or route resolution in view code. New message keys go into both EN and ES catalogs. Each dependent task starts from a tested, merged prerequisite or a pinned integration branch with a published contract.

## DUX-01 — Immediate navigation, obstruction and contrast repair

- [x] **Scope** UX-02, UX-06, UX-11. Independent of backend changes.
- [x] **Files** `portal/index.html`, `assets/portal.js::render()/showPublicationFeedback()`, `assets/portal.css`, `assets/diary.js::renderFields()`, `tests/browser/a11y-smoke.mjs`.
- [x] Remove static duplicate Care details. Produce a single customer destination, none for staff or signed-out people. Keep Account hidden while signed out.
- [x] Position notices where they cannot intercept the menu, language switch, primary action or focused field. Announce success through the existing status region. Keep critical error messages available until acted on.
- [x] Replace opacity-based hidden-answer styling with readable text plus an explicit Hidden from client label. Use selected-date colors that pass contrast.
- [x] **Acceptance** At 1440×900 and 390×844, save intake, then open the hamburger without dismissing the notice. All role menu links resolve to visible destinations. Axe finds no 1.4.3 failure on a published Poop No staff chip or selected stay dates in EN and ES. Existing Escape/focus-return behavior passes.

## DUX-02 — Consistent shell and route presentation

- [x] **Dependency** CUX-01 route descriptors and canonical resolution.
- [x] **Files** All six HTML shells in the ownership table, `assets/home.css`, `assets/portal.css`, `assets/home.js`, `assets/public-i18n.js`, `assets/portal.js::render()/showSection()`, `assets/care-portal.js::loadCareSection()`, EN/ES catalogs.
- [x] Apply the landing page's recognizable full-width header and permanent hamburger placement to public and authenticated destinations. Retain the homepage's existing approved brand behavior.
- [x] Render public, customer, owner, and sitter destination sets from the route contract. Use one label per concept and one current-location indicator.
- [x] Add skip navigation and a focusable main target. Give each route an appropriate document title, visible heading and return destination. Render explicit unavailable/forbidden/unknown states from CUX-01.
- [x] **Acceptance** Walk homepage → About → FAQ → sample → rates → portal in each language. Menu placement, link order for shared destinations, current state and language control remain predictable. Browser Back/Forward returns to the previous task. An unknown hash never silently masquerades as home. Sitter menu exposes operational destinations and hides owner-only administration.

## DUX-03 — Mobile booking dock, targets and control hierarchy

- [x] **Scope** UX-05, UX-12: independent visual work complete. Ordered prerequisite integration remains part of DUX-04 after CUX-02.
- [x] **Files** `assets/portal.js::bookingForm()/updateTotal()/stayFields()`, `assets/care-portal.js::blockerHtml()/stayCalendar()`, `assets/portal.css`, `assets/home.css`, `assets/myo-launch.css`.
- [x] Keep the sticky booking area to the selected summary and one next action. Move full blocker explanations into normal document flow. Label each resolution action by task, such as Update Rabies record, rather than repeating Resolve this requirement.
- [x] Enlarge calendar day, help, logo and rates-anchor hit areas to 44×44. Flatten calendar padding so seven columns fit at 390px. At narrower widths provide a fully operable alternative date control if a 44px grid cannot fit, without horizontal scrolling.
- [x] Keep disabled-action explanations adjacent to their action. Show quote recalculation and success feedback without pushing the active field out of view. Honor reduced motion.
- [x] After CUX-09, label peak and short-notice days, explain unavailable capacity, and progressively disclose long time lists with More times. Default according to server eligibility/notice metadata, preserving an explicit customer selection.
- [x] **Acceptance** Four simultaneous prerequisites do not turn the dock into a viewport-sized panel. As a layout budget, target at most 25% of the 844px viewport at default text size; enlarged text may expand in normal flow. Effective targets meet 44×44 at 390px and 1440px. At 200% text, actions remain reachable without overlapping fields. EN/ES selected dates pass contrast.

## DUX-04 — Guided authentication and first booking

- [ ] **Dependency** CUX-02 booking intent and prerequisite state. CUX-01 for canonical navigation.
- [ ] **Files** `assets/portal.js::auth()/bookingForm()/render()`, `assets/care-portal.js::blockerHtml()`, `assets/portal.css`, `assets/ui-copy.js`, `assets/care-copy.js`.
- [ ] Present sign-in and create-account as explicit modes with one primary action in the selected mode. Preserve the service and dates across the transition.
- [ ] Render the ordered steps from CUX-02 with current/completed/required status. Provide Continue booking after completing a detour, with the destination supplied by the controller.
- [ ] Use the same progress model for meeting prerequisites and paid requests. Explain when the meeting is a separate appointment and when a date is only a preference. Do not imply a hold before one exists.
- [ ] **Acceptance** A new parent starts from a service CTA and can reach review through visible next actions without opening the menu to discover prerequisites. Back, language switch, pet addition, agreement acceptance and reload retain supported nonsensitive intent. A returning client enters the next incomplete step. Completed prerequisites remain recognizable.

## DUX-05 — Intake, pet forms and consistent validation

- [x] **Dependency** CUX-03 field ownership, conditional requirements, safe draft adapter and field errors.
- [x] **Files** `assets/care-portal.js::careSettings()/intakeDefaults()/bindCareUi()`, `assets/portal.js::petForm()/profileGroups/petFieldError()`, `assets/myo-launch.js`, `assets/portal.css`, `assets/myo-launch.css`, relevant copy catalogs.
- [x] Render pet-specific care separately from household emergency contacts and authorization. Prefill canonical saved values and identify which pet each answer applies to.
- [x] Split the long intake into bounded groups with Save and continue and a visible completion summary. Keep optional or service-specific questions conditional.
- [x] Put structured field errors next to the fields, use `aria-invalid` and `aria-describedby`, and focus an error summary or first invalid field after submission. Show pending, saved, unsaved and failed-save states.
- [x] Apply Claude's sensitive-field classifications through markup attributes. Keep home-entry secrets out of saved drafts.
- [x] **Acceptance** Unsaved nonsensitive feeding text survives reload through the supplied draft adapter, while door/lockbox codes never appear in storage. Zero emergency spending authorization is accepted. Switching service toggles only relevant requirements. Saving household contacts does not make the parent retype each pet's feeding details. Invalid submission preserves values and identifies the exact field in EN/ES.

## DUX-06 — Pricing, stay units and honest financial review

- [ ] **Dependency** CUX-04 for deposit, deadline and cancellation semantics. Unit-label corrections and clear starting-price wording can ship independently.
- [ ] **Files** `assets/home.js`, `assets/price-sheet.js`, `assets/portal.js::bookingForm()/quoteLines()/checkoutSummary()/confirmCancellation()`, `assets/myo-launch.js`, `assets/policy-copy.js`, `assets/myo-copy.js`, `assets/ui-copy.js`, `assets/portal.css`.
- [x] Replace overnight minute labels with per-night rates and arrival/departure dates. Keep visit duration in minutes.
- [ ] Label preview prices as starting estimates and show relevant peak, short-notice and extra-pet conditions before commitment. Surface the configured service area near the start action.
- [ ] Render authoritative total, deposit due, remaining balance, deadline, confirmation state, cancellation terms and refunds from CUX-04. Capability failures receive a clear next action.
- [ ] **Acceptance** A same-day $30 walk that quotes at $45 explains the $15 adjustment before final review. A two-night stay uses nightly units everywhere. Review, policy page and cancellation dialog show matching amounts/terms from the same backend contract. Payment-return URLs alone never show Paid. Missing provider configuration cannot lead to an unusable Pay deposit button.

## DUX-07 — Current-task dashboards, visit workspace and admin groups

- [ ] **Dependency** CUX-01 route model and CUX-05 visit summaries/actions.
- [ ] **Files** `assets/portal.js::clientHome()/staffHome()/bookingCard()/publishingDesk()/eventForm()/adminSettings()/showFinancials()`, `assets/care-portal.js::staffCareTools()/clientSection()/clientRecord()`, `assets/diary.js`, `assets/portal.css`, relevant copy catalogs.
- [ ] First bounded slice shows active client care, latest update and the next outstanding action before new booking. Keep new booking easy to find.
- [ ] Second slice makes staff home a due-work list. Selecting a visit opens its stable workspace containing start, entry, publish, summary and completion actions appropriate to state.
- [ ] Third slice groups administration into availability, services/pricing, policies, team, money and backups using CUX-01 destinations. Preserve direct access from legacy hashes.
- [ ] **Acceptance** A returning parent reaches the current visit or latest update in one action from home. An owner runs one selected visit through start → publish → complete without searching other visits. Two active visits never cross-assign updates. Sitter sees operational tools. Owner settings no longer requires scrolling past unrelated forms to reach a named administrative task.

## DUX-08 — Loading, empty, offline and recovery surfaces

- [ ] **Dependency** CUX-06 for update freshness and stale-response handling, CUX-07 for recovery capability. Local rates/session retry UI can ship independently.
- [ ] **Files** `assets/price-sheet.js`, `assets/portal.js::refresh()/refreshDiaryView()/auth()/stayFields()`, `assets/care-portal.js::loadCareSection()`, `assets/portal.css`, copy catalogs.
- [ ] Give rates, initial session load, diary, client search and timeline explicit loading, empty, error and Retry states. Distinguish no published times from a request that failed.
- [ ] Show diary last checked/updated time, refreshing, stale and disconnected status from CUX-06. Preserve the reader's position and announce new updates without stealing focus.
- [ ] Provide account recovery according to CUX-07 capabilities. Show delivery or support availability truthfully.
- [ ] **Acceptance** Inject a failed availability/session request, restore connectivity and recover using the visible retry action. No page reload or infrastructure jargon is required. Failure preserves nonsensitive work. An open diary receives or signals new events within the contract's budget. Recovery shows translated success/error states and does not reveal whether an email belongs to an account.

## DUX-09 — EN/ES and system-copy reconciliation

- [ ] **Scope** UX-21, UX-23 and all new UI strings. Runs with each UI slice.
- [ ] **Files** `assets/i18n.js`, `assets/ui-copy.js`, `assets/care-copy.js`, `assets/myo-copy.js`, `assets/policy-copy.js`, `assets/public-i18n.js`, human-facing strings in Codex-owned renderers.
- [ ] Remove the obsolete Financials statement denying collected payments/refunds. Distinguish booked revenue from money collected and balance owed.
- [ ] Replace English concatenated visit plurals with catalog plural entries. Use consistent customer/admin labels and natural Spanish actions. Preserve user-authored text.
- [ ] Keep language choice visible and persistent through auth, external checkout return, progress and error states.
- [ ] **Acceptance** Exercise completed/paid/declined/empty data in both languages. Every new system string has an EN/ES entry. No system-generated English sentence leaks into the Spanish journey. Dates and currency follow selected locale. Long labels wrap without hiding the action. Review Spanish tone with a fluent speaker before launch.

## DUX-10 — Behavioral regression and final review

- [ ] **Files** `tests/browser/portal-smoke.mjs`, `tests/browser/care-smoke.mjs`, `tests/browser/a11y-smoke.mjs`, `tests/browser/i18n-smoke.mjs`, `tests/browser/payments-smoke.mjs`, `tests/browser/staff-smoke.mjs`; add focused `tests/browser/ux-flow-smoke.mjs` only for gaps; `package.json`.
- [ ] Use actual menu/CTA clicks for the audited journeys. API fixture creation is acceptable for pre-existing active/history states and must be labeled.
- [ ] Test a fresh parent, returning parent, owner and sitter at 1440×900 and 390×844 in EN/ES. Include empty data, pending prices, four blockers, after-save notices, selected calendar dates, hidden staff answer chips, network errors and Back/Forward.
- [ ] Enforce the 44px project requirement using effective hit areas, documenting justified inline-link exceptions. Run axe on populated states, not only empty forms.
- [ ] **Acceptance** New parent reaches the modeled review via discoverable next actions; returning parent finds active updates; owner runs the correct visit; sitter restrictions hold. No unhandled console errors, document overflow, blocked menu clicks, serious/critical axe violations, sensitive draft leakage or incorrect payment claims. Perform keyboard focus/escape tests and a 200% text pass. Record real-device and screen-reader testing separately.
- [ ] Include Claude's guest-first scenario after CUX-08/09 and DUX-11/12 land. Verify a public preview before registration, an outside/uncertain area result, a full day, a notice-free default when available, acknowledgment of current terms, and the approved meeting/deposit sequence. Run the financial journey with the fake provider and verify webhook-driven confirmation and unpaid expiry on Node and Worker. Target at most four screens for an eligible returning client with complete intake, documenting extra screens only when a real outstanding requirement applies.

## DUX-11 — Clear landing entry, guest preview and eligibility

- [ ] **Issues** UX-15, UX-26, UX-27. Preserves Claude X-U1 and the guest portion of X-U11.
- [ ] **Dependency** CUX-08 public eligibility/quote/contact contract, CUX-09 availability metadata, and CUX-02 booking intent. Visible service-area and CTA copy can ship first using confirmed configuration.
- [ ] **Files** `index.html`, `myo/launch/index.html`, `assets/home.js`, `assets/home.css`, `assets/portal.js::auth()/bookingForm()`, `assets/myo-launch.js`, `assets/price-sheet.js`, EN/ES catalogs, `tests/browser/ux-flow-smoke.mjs`.
- [ ] Put a clearly labeled availability action and starting-price/service-area context in the hero. Keep the paw visual, with a visible action label where necessary for discovery.
- [ ] Render guest service/date/price exploration before contact/account commitment. Show eligible, outside-area and needs-review results from CUX-08. Ask for client phone and service address at the documented contact step, preserving the quote intent.
- [ ] Replace duplicate public intake with a continuation into canonical intake only after CUX-03 provides compatibility and recovery. Rewrite How It Works around the approved executable sequence.
- [ ] **Acceptance** EN/ES at 390×844 and 1440×900 provide a discoverable labeled start and service-area context without searching another page. Guests obtain a server quote without creating an account. Signing in/registering preserves dates and pets. An unknown ZIP or radius boundary gets a review outcome; the UI never treats a centroid as precise address verification.

## DUX-12 — Request confirmation and next actions

- [ ] **Issue** UX-29. Preserves Claude X-U8.
- [ ] **Dependency** CUX-01 route, CUX-02 intent, CUX-04 financial semantics and CUX-05 confirmation/timeline contract.
- [ ] **Files** `assets/portal.js` request success and selected-booking renderers, `assets/portal.css`, `assets/ui-copy.js`, `assets/care-copy.js`, `tests/browser/ux-flow-smoke.mjs`.
- [ ] Render a stable confirmation destination with request reference, service/dates, truthful status, ordered next actions and a progress timeline. The primary action is the first available incomplete task.
- [ ] Show meeting time, owner-review state, deposit amount/deadline and diary destination only as supplied by the contract. Distinguish notification queued from message delivered.
- [ ] **Acceptance** After request submission a parent knows whether care is confirmed and what happens next. Reload and bookmarked confirmation work under access control. Back cannot replay the final request. A returning client with completed prerequisites sees review/payment progress without obsolete intake or meeting prompts.

## Delivery order

Ship DUX-01 first. DUX-03 target fixes and DUX-08 local retries can proceed while Claude works on CUX-01/02. Integrate DUX-02/04 after those contracts. Then pair DUX-05 with CUX-03, DUX-06 with CUX-04, and DUX-07/08 with CUX-05/06/07. DUX-09/10 accompany every batch.

DUX-11 proceeds after CUX-08/09 contracts; DUX-12 follows CUX-05 confirmation data. Each PR should identify issue IDs, contract versions, EN/ES screenshots, relevant behavioral checks and any unverified device/provider behavior. Keep changes bounded by the slice above. Completion of this plan is a future implementation outcome, not a claim made by this documentation change.

---

## Preserved Claude source from b89aa1f

The original November 19 document is retained below for attribution, evidence, and continuity of its issue and ticket IDs. The reconciled sections above are the active execution plan. Proposed policy defaults and UI ownership in this source are subject to the reconciliation above.

<details>
<summary>Read Claude's complete original document</summary>

<!-- claude-source-b89aa1f-start -->
# Codex UX plan: UI layer, copy, accessibility and end-to-end tests

**Source:** [docs/ux-flow-audit.md](../ux-flow-audit.md) (issues #1–#20). **Depends on:** [claude-ux-plan.md](claude-ux-plan.md), which delivers the routes, state (`assets/booking-flow.js`), API contracts and unstyled step markup. Codex does not change pricing, eligibility, deposit, Meet & Greet or cancellation rules, server routes or migrations; if a contract is missing something, raise it against the CU step instead of working around it.

**Order:** X-U1 and X-U10 can start immediately (no dependency). Every other ticket starts once its CU step has merged. Each ticket lists files, the change and acceptance criteria that a Playwright test or a reviewer can check at **1440×900** and **390×844**, in **English and Spanish**.

**Shared rules for every ticket**
- All visible text goes through `t()` with entries in both languages (`assets/ui-copy.js`, `assets/care-copy.js` or `assets/myo-copy.js`); `tests/i18n.test.mjs` must stay green.
- Tap targets are at least 44×44 CSS px; no horizontal scroll at 320, 390 and 1440 px; one primary button per screen (filled style), everything else secondary.
- Every new interactive element has a visible focus ring (`:focus-visible`) and an accessible name; `tests/browser/a11y-smoke.mjs` (axe) passes on every new screen.

## X-U1: Landing hero, price and service area (no dependency; ZIP field after CU1)
**Fixes:** #10, #11, #18. **Files:** `index.html` (hero `.hero-actions`, `#how`), `assets/home.css`, `assets/home.js`, `assets/public-i18n.js`, `assets/ui-copy.js`.
- Add a primary **Check availability** button in `.hero-actions` linking to `portal/index.html#book/service`; demote **See How It Works** to a text link.
- Add one line under the description: "From $30 a visit · within 15 miles of Springfield, MA", with the price and radius read from `assets/myo-config.js` (`rates.visit`, `business.radiusMiles`, `business.city`).
- On mobile, keep **Book a Visit** labeled (text plus paw) in the header instead of the icon-only state at `assets/home.css` line 185; if space is short, hide the menu label rather than the booking label.
- After CU1: an inline ZIP field ("Check your ZIP") beside the hero CTA that calls `GET /api/eligibility` and shows "Great, you're in Myomi's area" or "Outside the 15-mile area. Contact Myomi" with the contact link.
- Rewrite `#how` to the real five steps: choose care → see your price → tell us about your pet → confirm with a 50% deposit → meet Myomi and get updates.

**Acceptance:** at 390×844 and 1440×900, in EN and ES, a labeled primary booking button, a price and "15 miles" are visible without scrolling; the hero has exactly one filled button; a ZIP inside the area (for example `01108`) shows the success message, a ZIP outside it (for example Boston, `02108`) shows the outside message, and both are announced (`role="status"`).

## X-U2: Price sheet and service labels (after CU7)
**Fixes:** #13, part of #6. **Files:** `assets/price-sheet.js`, `assets/portal.js` (`bookingForm()` service choice labels), `assets/ui-copy.js`.
- Overnight: "From $95 a night · next available night: Fri, Nov 27" using `overnight_nights`; never "720 min".
- Visits: show the regular price and, if the listed times are within the notice window, a note "+$15 within 3 days".
- Service cards in the booking form show "30-minute visit" / "Overnight (per night)" / "Meet & Greet · Free".

**Acceptance:** the signed-out price sheet never shows "No available times" for overnights while nights are open; no service label contains "720 min"; ES labels fit on one or two lines at 390 px without clipping.

## X-U3: Booking details layout on mobile (after CU0, CU7)
**Fixes:** #12, #20. **Files:** `assets/portal.css` (`.portal [data-booking-summary]`), `assets/portal.js` (`updateQuote()` time groups) or the step markup from CU0.
- Replace the top-sticky quote panel with a bottom sheet on viewports under 700 px: a collapsed bar ("$30.00 · Thu, Nov 26 · 10:00 AM" + the primary button) that expands to show the lines. It must never cover the service, day or time choices.
- Show the first 4 times per Morning/Midday/Evening group and a "More times" button per group.

**Acceptance:** at 390×844, with two blockers present, no service card, day chip or time chip is covered by the summary (checked with `elementFromPoint` on each chip's center); the details step is under 1,300 px tall before "More times" is opened.

## X-U4: Day chips show peak, last-minute and full days (after CU7)
**Fixes:** #6, #7. **Files:** `assets/portal.js` (day choice rendering), `assets/portal.css`, `assets/ui-copy.js`.
- Use the `days` metadata: "Peak" tag on peak days, "+$15 short notice" tag on last-minute days, full days omitted, and the default selection on the first fee-free day.
- Legend under the chips explaining both tags.

**Acceptance:** with a seeded peak date and a full day (staff-created bookings), the full day is absent, the peak day carries the tag, the default selected day is the first day without the short-notice tag, and the first total shown equals the regular price.

## X-U5: Intake as a three-step stepper; retire the duplicates (after CU3)
**Fixes:** #8. **Files:** new step views rendered from `myoConfig.intakeSteps`; `assets/care-portal.js` (`careSettings()` becomes a read-only summary with "Edit" links into the steps); `assets/portal.js` (`petForm()` reduced to name, species, age, weight); `myo/launch/index.html` and `assets/myo-launch.js` (remove `#intake-form`, keep a link "Start your care details" to `portal/index.html#book/intake/1`).
- One screen per step with "Step n of 3", **Save & continue** as the only primary button, **Back** as secondary, inline errors from `missing` next to each field, and saved-step checkmarks.
- Help toggles become 44×44 (#16).

**Acceptance:** no intake screen is taller than 1,600 px at 390×844; each step saves independently (reload on step 3 keeps steps 1–2); no field label appears in both the pet form and the intake; `/myo/launch/` has no form posting to `/api/intake`.

## X-U6: Progress indicator and loading, empty and error states (after CU0)
**Fixes:** momentum across #5, #8, #9. **Files:** new `assets/flow-progress.js` (renders `steps` from `booking-flow.js`), `assets/portal.css`, `assets/ui-copy.js`.
- A five-segment progress bar with step names on desktop and "Step 2 of 5 · Date & time" on mobile; `aria-current="step"` on the current segment; completed segments are links back.
- Skeleton states while the quote, availability and intake load; an inline error with **Try again** for each request failure; empty states for "no times this week" with the next available date.

**Acceptance:** each flow step shows the indicator with the correct current step in EN and ES; screen readers announce step changes (heading focus, `aria-live` region); throttling the quote request shows a skeleton, and a forced 500 shows a retry button that recovers.

## X-U7: Review screen with deposit and terms (after CU5, CU6, CU4)
**Fixes:** #2, #3, #19. **Files:** `assets/portal.js` (`checkoutSummary()` or the CU0 review step), `assets/portal.css`, `assets/ui-copy.js`, `assets/policy-copy.js` (display only).
- Receipt rows: items, **Total**, **Due within 48 h of Myomi accepting: 50% deposit $X**, **Balance on the visit day $Y**.
- Plain-language terms from `terms.summary_key` with a "Full policy" link, and a required checkbox "I've read the cancellation terms" bound to `accept_terms_version`; the primary button is disabled until checked.
- For a first-time client (CU4) show both the Meet & Greet and the visit, and say the visit is confirmed after meeting.
- Meet & Greet-only review: "Free · no payment needed" instead of "Visit total"; use "Massachusetts time" consistently instead of mixing "ET".

**Acceptance:** for a $30 visit the review shows $15.00 deposit and $15.00 balance; the send button is disabled until the box is ticked; ticking and sending succeeds; a server `terms_changed` re-renders the new text and unticks the box; ES text matches EN amounts and fits at 390 px.

## X-U8: Confirmation screen with next steps (after CU8)
**Fixes:** #9. **Files:** `#book/done/<id>` view (CU0 markup), `assets/portal.css`, `assets/ui-copy.js`.
- A dedicated confirmation: "Request sent" heading, booking summary, the `timeline` as a vertical status list, and `next_steps` as ordered action cards (for example "Complete your care details", "Your Meet & Greet is Thu at 10:00", "Pay your deposit after Myomi accepts", "Updates will appear in your Pet Diary").
- One primary action: the first incomplete next step.

**Acceptance:** after sending a first-time request the confirmation shows the Meet & Greet time, at least one next step and the timeline; a returning client with complete intake sees "Myomi will review your request" first; Back from the confirmation goes to **My bookings**, not the review.

## X-U9: Client home and portal navigation (after CU4)
**Fixes:** #14, #17. **Files:** `assets/portal.js` (`clientHome()`, `render()` links), `portal/index.html` (menu), `assets/care-copy.js`.
- Show the Meet & Greet tile only when `meet_status` is `needed` (or `scheduled`, as a reminder with the time); make **Book a visit** the first tile otherwise.
- Remove the hard-coded **Care details** link from `portal/index.html`; show it once, signed in only.

**Acceptance:** a client with a completed Meet & Greet doesn't see "required for each new booking"; the portal menu lists each destination once; signed-out visitors see no **Care details** link.

## X-U10: Tap targets, focus and contrast pass (no dependency)
**Fixes:** #16 and the rubric. **Files:** `assets/portal.css` (`.pet-field-tip summary`), `assets/home.css` (`.wordmark`, `.service-pills a`), `assets/portal.css` choice chips.
- Grow help toggles and the wordmark link to 44×44 hit areas (padding, not larger glyphs); verify focus rings on chips and summary toggles; check text on `--tomato` fills meets 4.5:1.

**Acceptance:** a script listing all visible links, buttons and summaries at 390×844 on `/index.html`, `/myo/launch/` and every portal flow step reports none under 44×44 (checkbox and radio inputs excluded when their label is the target); axe reports no color-contrast violations.

## X-U11: Playwright end-to-end suite for the five-step flow (after X-U1–X-U8)
**Files:** new `tests/browser/flow-smoke.mjs`; add it to `test:browser` in `package.json`.
- Runs at 1440×900 and 390×844, in EN and ES, against `MYO_PRICING_MODE=launch` and `MYO_PAYMENTS=fake`, on Node and with `MYO_TARGET=worker`.
- **First-time client:** landing → ZIP check → **Check availability** → service and date (first fee-free day preselected) → quote visible before any account → "About you" (account + address) → intake steps 1–3 → review (deposit, balance, terms checkbox) → confirmation with Meet & Greet and next steps. Staff completes the Meet & Greet and accepts; the client sees **Awaiting deposit**, pays through the fake checkout, the signed webhook confirms.
- **Returning client:** sign in → **Book a visit** → no intake and no Meet & Greet steps → review → confirmation in three screens.
- **Edges:** outside ZIP is stopped at step 1; a full day is not offered; the hold expires on review and recovers; a deposit not paid within 48 h (clock moved forward) cancels the booking and frees the time; Back on every step returns to the previous step with entries kept.
- Fails on any console error, CSP violation, horizontal overflow, or tap target under 44×44.

**Acceptance:** the suite passes in all four combinations (2 viewports × 2 languages) on both runtimes, and the returning-client path completes in at most 4 screens from the portal home.

## X-U12: Bilingual copy pass (after X-U1–X-U9)
**Files:** `assets/ui-copy.js`, `assets/care-copy.js`, `assets/myo-copy.js`, `assets/policy-copy.js` (display strings only).
- Review every new string for tone (warm, plain, second person), consistent terms (one Spanish name each for Meet & Greet, deposit, balance, care details), and length at 390 px.

**Acceptance:** a glossary table in `docs/i18n-glossary.md` lists each product term in EN/ES; no ES button label wraps to three lines at 390 px on any flow step; a native Spanish speaker review is recorded in the same doc (or listed as pending).

<!-- claude-source-b89aa1f-end -->

</details>

## Handoff Notes — November 19, 2026 — DUX-01

- DUX-01 is complete. The homepage reference was inspected in source and rendered desktop/mobile screenshots before editing. The portal treatments use the existing Fraunces/Outfit pairing and paper, peach, cream and ink palette.
- The customer Care details destination is emitted by the role-specific links in `assets/portal.js::render()`. The duplicate static `#care` link was removed from `portal/index.html`, so public, owner and sitter menus do not expose it.
- `.portal-feedback.is-notice` is an in-flow rounded peach notice. Its status region and dismiss control remain available, and saving intake permits immediate menu/language-control interaction.
- `assets/diary.js::renderFields()` adds a visible `.diary-field-note` on staff-only answers using the existing EN/ES Hidden from the client catalog entry. The dashed paper chip replaces opacity/strike-through styling. Customer filtering remains enforced by the API.
- Selected stay endpoints use ink with cream text. The peach range treatment and selected endpoint contrast are covered by populated-state axe checks.
- Validation passed JavaScript syntax checks, all seven i18n tests, and the complete nine-script Chromium browser command. The added DUX-01 matrix exercises public/customer/owner/sitter menus in EN and ES at 1440×900 and 390×844, actual intake-save/menu interaction, keyboard focus, selected stays and staff-only answer contrast. Screenshots at both sizes were visually reviewed. Physical-device and screen-reader checks remain pending.
- The next sequential task is DUX-02. Its CUX-01 route descriptor/resolution contract was absent from main and audit-remediation when checked for this batch. Claude should publish that contract before Codex integrates the shared shell and canonical navigation.

## Handoff Notes — November 19, 2026 — DUX-02

- CUX-01 from Claude's batch 1 is integrated through the read-only `assets/portal-route-state.js` contract. DUX-02 is complete for current screens. No Claude-owned module, backend, financial rule or plan was edited.
- All six HTML shells now share the homepage's full-width sticky header, permanent hamburger, language control, and focusable skip target. Public menus use the same destinations and order. The portal uses `routesFor(session)` for role-aware links and `resolveLocation()` for presentation, canonical legacy links, sign-in return destinations, current-location state, titles and recovery views.
- Existing checkout, pet-history and add-pet views accept `#visit/<id>`, `#pet/<id>` and `#pets/new`. Client records now open/reload at `#client/<id>`, with stale successful responses ignored. `#settings/<group>` currently opens the existing settings screen; grouping its forms belongs to DUX-07. No new controller or financial workflow is implied.
- Future CUX-02 booking-step hashes show a translated recovery action to booking until their controller/UI exists. Unknown/forbidden links have explicit recovery screens. Private destinations survive sign-in. Checkout-return feedback is captured before query canonicalization.
- Public menu Escape, outside-click dismissal and current-location marking are centralized in `assets/public-i18n.js`; portal menu behavior stays in `assets/portal.js`. Rates-page details styling is scoped to its main content so it cannot distort the shared menu. Portal focus/section scroll margins accommodate the sticky header.
- Added `tests/browser/navigation-smoke.mjs` to the browser chain: actual public click paths, EN/ES persistence, customer Back/Forward, sign-in return, canonical legacy links, client-record reload and missing/forbidden recovery at 1440×900 and 390×844. The existing portal smoke explicitly opens staff home after sign-in because requested destinations are now preserved.
- The next task is DUX-03: its visual work and CUX-09 availability metadata are ready; prerequisite ordering still waits on CUX-02. DUX-04/05/06/07/08 depend on the remaining Claude contracts as listed above. Do not infer that CUX-02 or CUX-04 is complete from this navigation integration.
- Validation: all ten Chromium browser scripts, seven i18n tests and changed-JavaScript syntax checks passed. EN/ES rendered shells were reviewed at 1440×900 and 390×844. Physical-device and screen-reader verification remains pending.

## Handoff Notes — November 19, 2026 — DUX-03

- The independent DUX-03 UI work is complete. `assets/portal.js::bookingForm()` keeps the sticky dock to its appointment/price summary, a short disabled-action explanation and one Review booking button. Price line items, retry, package credit and full prerequisite explanations are in normal flow above it. `blockerHtml()` links name the task: update a vaccine record, review the agreement, book the meeting or update care details. It does not order prerequisites or change policy.
- `assets/portal.css` gives help controls and calendar dates 44px targets; the global wordmark has a minimum 44px hit height. The calendar uses seven 44px columns at 390px. Container queries hide the optional grid when it cannot fit, retaining the labeled native arrival/departure date controls. Narrow/enlarged-text layouts place the summary in normal flow rather than covering the active field. Existing rates anchors already met 44px and needed no changes.
- `availabilityMetadata()` consumes CUX-09's `/api/availability/days?service=`. Daytime choices use the server's eligible default, label peak/short-notice days, exclude closed days and explain full capacity. Explicit day/time choices survive later metadata. Overnight calendar annotations name peak/short-notice dates; the customer still chooses both stay endpoints. More times discloses time choices beyond four per time-of-day group and opens automatically around a restored selection.
- Late availability responses are ignored for presentation while a hold is being created or its review is visible. The response stays cached. This preserves the held inputs and quoted cents through language changes; no controller or financial logic was changed.
- New `tests/browser/booking-ergonomics-smoke.mjs` covers four simultaneous blockers, the <=25% mobile dock budget, server default/capacity labels, More times, choice preservation, 44px help/logo/calendar targets and 320px/200% text fallback in EN/ES. `tests/browser/holds-smoke.mjs` now opens More times before tapping an overflow choice. `tests/browser/i18n-smoke.mjs` deliberately delays availability responses until after restoring a translated held review.
- DUX-04 is next in the sequential plan and still waits on CUX-02. Claude batch 2 supplies CUX-03/05/06/07 for later UI tasks and reached main at `701b3dc` during this batch. That baseline was merged into the Codex branch without editing Claude-owned files or documents. Review that handoff before starting DUX-05/07/08/12. CUX-04 financial lifecycle remains pending.
- Validation: all eleven browser scripts passed across the regression run and targeted reruns after the held-review guard; seven i18n tests and changed-JavaScript syntax checks passed. EN/ES dock and calendar screenshots at 1440×900 and 390×844 were reviewed. Physical-device and assistive-technology verification remains pending.

## Handoff Notes — November 19, 2026 — DUX-05

- DUX-05 integrates CUX-03 through a new Codex-owned presentation module, `assets/intake-ui.js`. It imports the existing `intakeFields`, `intakeGroups` and `validateIntake` contract without changing the model, API, schema or draft serialization. The form uses three sections: pet routines, health, and household contacts/authorization, with one Save and continue action, previous-section navigation and a visible completion summary.
- Saved intake answers take precedence. Missing answers are prefilled from each pet's profile using the model's `profileKeys`, with pet names retained in combined notes. Household contacts and spending authorization are grouped separately. The canonical API remains one household record; no new pet/household storage format was introduced.
- Each section posts only its fields plus service and `partial:true`. The server decides completeness. Saves preserve values in other sections, update current-field defaults and capture remaining drafts. Saving has a pending state; failures keep answers and a visible retryable action. Editing a saved section changes its progress label to Unsaved. Final success uses the existing in-flow Saved notice.
- `assets/portal.js::api()` now forwards structured `fieldErrors`. The UI validates against the shared rules, renders translated field errors with `aria-invalid`/`aria-describedby`, focuses the first invalid answer, and preserves error codes, section and answers on language changes. The emergency authorization select is replaced with large radio choices. Blank spending authorization is missing, while zero is valid.
- `configureCareUi()` receives the existing `drafts` adapter. The shared draft restore callback distinguishes intake from pet-profile steps. Routine notes remain tab drafts; health/emergency answers use the model's memory-only policy; entry instructions still never become drafts. Copy explains when Save is needed before reload.
- Added `tests/browser/intake-smoke.mjs` to the browser chain and a shared `intake-steps.mjs` helper for the existing care/accessibility journeys. Coverage includes independent partial saves, two-pet prefill, reload, structured server errors, EN/ES error persistence, failed saves and retry, zero authorization, conditional overnight fields, first-error/save focus, sensitive draft exclusions, saved-answer precedence after adding a pet, populated-state axe and 200% text at 1440×900 and 390×844.
- The public rates/launch page and its duplicate preview intake were deliberately left alone because the user may have unpushed changes on another desktop. DUX-11 still owns its eventual retirement. No homepage markup or brand tokens were changed.
- DUX-04 still needs CUX-02's booking intent/controller. During this batch Claude published `f093d4b` and `6be2ccf`: once-per-client Meet & Greet, 24-hour meeting notice and request-triggered deposit terms. Preserve his README/plan and review the batch 3 contract before DUX-06. This intake change does not alter those business rules or imply that the financial UI is complete.
- Verification before integration: the progressive-intake EN/ES matrix, populated-state axe, 200% text, sensitive-draft, retry and partial-save checks passed. Screenshots at 1440×900 and 390×844 were visually reviewed. The complete browser chain is being rerun on Claude's batch 3 baseline before merge; its final outcome will be recorded in the PR. Physical-device and screen-reader checks remain pending.

## Handoff Notes — November 19, 2026 — DUX-06 pricing-unit slice

- Completed the independent unit-label portion of DUX-06. Homepage service tags and the signed-out price sheet say From / Desde, use per-night units for overnight services, and retain minutes for daytime visits. Booking service choices say per night / por noche; the existing stay form retains arrival/departure controls. Overnight service durations remain unchanged in storage and scheduling.
- `assets/price-sheet.js` uses the existing public availability response's `nights` for overnight dates. An empty daytime `times` array no longer falsely means no overnight availability. If no nights are returned, the copy directs the visitor to check stay dates rather than claiming there are no overnight openings. A brief EN/ES note explains that peak dates, short notice and extra pets can change the starting quote.
- Added `tests/browser/pricing-units-smoke.mjs`: actual catalog fixtures and page rendering at 1440×900 and 390×844 in EN/ES, asserting nightly homepage/public/booking labels, daytime minutes and overnight availability. The booking form and ergonomics regressions and seven i18n tests passed; changed-JavaScript syntax checks passed.
- The rates/launch page is untouched. Full DUX-06 remains open: terms acknowledgment, authoritative deposit/balance/deadline presentation, cancellation/refund semantics, provider capability and service-area context. Consume Claude's batch 3 contract before implementing those screens; this slice makes no new payment promises.
## Handoff Notes — November 19, 2026 — DUX-06 financial-review slice

- Booking review snapshots the authoritative quote's deposit, remaining balance and terms. It explains the server's request-triggered deadline, manual/online collection and cancellation retention before sending, with no implied confirmation or automatic charge. Consent is required for a paid launch request and sends `accept_terms_version`; `terms_changed` releases the held review, refreshes the quote and requires fresh consent. A language switch preserves consent only for the same held snapshot. Consent is never restored from a stored draft.
- Requested launch bookings expose the existing deposit payment action only when the provider is enabled and `payment.stage` is `deposit`. Cards label deposit amounts/deadlines explicitly; manual collection directs the client to Myomi. The cancellation dialog uses deposit wording for `model:'deposit'`, retaining the existing catalog fee wording. No backend, financial rule or policy file was changed.
- Added `tests/browser/financial-review-smoke.mjs`: real launch-mode fixtures with completed Meet & Greets; manual and online providers; EN/ES at 1440×900 and 390×844; consent blocking/focus, same-review language switching, changed-terms recovery, persisted acceptance/version and provider-aware payment actions; populated-state axe and overflow checks. Existing bilingual review and payment regressions pass. Full DUX-06 remains open for the remaining service-area, balance-timing, refund and final journey acceptance work.
