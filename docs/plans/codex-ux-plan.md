# Codex UX remediation plan

Prepared November 19, 2026 from the [flow audit](../ux-flow-audit.md), baseline `5d139ec`. All tasks below are unchecked implementation work. The audit changed documentation only.

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

- [ ] **Scope** UX-02, UX-06, UX-11. Independent of backend changes.
- [ ] **Files** `portal/index.html`, `assets/portal.js::render()/showPublicationFeedback()`, `assets/portal.css`, `assets/diary.js::renderFields()`, `tests/browser/a11y-smoke.mjs`.
- [ ] Remove static duplicate Care details. Produce a single customer destination, none for staff or signed-out people. Keep Account hidden while signed out.
- [ ] Position notices where they cannot intercept the menu, language switch, primary action or focused field. Announce success through the existing status region. Keep critical error messages available until acted on.
- [ ] Replace opacity-based hidden-answer styling with readable text plus an explicit Hidden from client label. Use selected-date colors that pass contrast.
- [ ] **Acceptance** At 1440×900 and 390×844, save intake, then open the hamburger without dismissing the notice. All role menu links resolve to visible destinations. Axe finds no 1.4.3 failure on a published Poop No staff chip or selected stay dates in EN and ES. Existing Escape/focus-return behavior passes.

## DUX-02 — Consistent shell and route presentation

- [ ] **Dependency** CUX-01 route descriptors and canonical resolution.
- [ ] **Files** All six HTML shells in the ownership table, `assets/home.css`, `assets/portal.css`, `assets/home.js`, `assets/public-i18n.js`, `assets/portal.js::render()/showSection()`, `assets/care-portal.js::loadCareSection()`, EN/ES catalogs.
- [ ] Apply the landing page's recognizable full-width header and permanent hamburger placement to public and authenticated destinations. Retain the homepage's existing approved brand behavior.
- [ ] Render public, customer, owner, and sitter destination sets from the route contract. Use one label per concept and one current-location indicator.
- [ ] Add skip navigation and a focusable main target. Give each route an appropriate document title, visible heading and return destination. Render explicit unavailable/forbidden/unknown states from CUX-01.
- [ ] **Acceptance** Walk homepage → About → FAQ → sample → rates → portal in each language. Menu placement, link order for shared destinations, current state and language control remain predictable. Browser Back/Forward returns to the previous task. An unknown hash never silently masquerades as home. Sitter menu exposes operational destinations and hides owner-only administration.

## DUX-03 — Mobile booking dock, targets and control hierarchy

- [ ] **Scope** UX-05, UX-12; independent visual work, with prerequisite ordering integrated after CUX-02.
- [ ] **Files** `assets/portal.js::bookingForm()/updateTotal()/stayFields()`, `assets/care-portal.js::blockerHtml()/stayCalendar()`, `assets/portal.css`, `assets/home.css`, `assets/myo-launch.css`.
- [ ] Keep the sticky booking area to the selected summary and one next action. Move full blocker explanations into normal document flow. Label each resolution action by task, such as Update Rabies record, rather than repeating Resolve this requirement.
- [ ] Enlarge calendar day, help, logo and rates-anchor hit areas to 44×44. Flatten calendar padding so seven columns fit at 390px. At narrower widths provide a fully operable alternative date control if a 44px grid cannot fit, without horizontal scrolling.
- [ ] Keep disabled-action explanations adjacent to their action. Show quote recalculation and success feedback without pushing the active field out of view. Honor reduced motion.
- [ ] **Acceptance** Four simultaneous prerequisites do not turn the dock into a viewport-sized panel. As a layout budget, target at most 25% of the 844px viewport at default text size; enlarged text may expand in normal flow. Effective targets meet 44×44 at 390px and 1440px. At 200% text, actions remain reachable without overlapping fields. EN/ES selected dates pass contrast.

## DUX-04 — Guided authentication and first booking

- [ ] **Dependency** CUX-02 booking intent and prerequisite state. CUX-01 for canonical navigation.
- [ ] **Files** `assets/portal.js::auth()/bookingForm()/render()`, `assets/care-portal.js::blockerHtml()`, `assets/portal.css`, `assets/ui-copy.js`, `assets/care-copy.js`.
- [ ] Present sign-in and create-account as explicit modes with one primary action in the selected mode. Preserve the service and dates across the transition.
- [ ] Render the ordered steps from CUX-02 with current/completed/required status. Provide Continue booking after completing a detour, with the destination supplied by the controller.
- [ ] Use the same progress model for meeting prerequisites and paid requests. Explain when the meeting is a separate appointment and when a date is only a preference. Do not imply a hold before one exists.
- [ ] **Acceptance** A new parent starts from a service CTA and can reach review through visible next actions without opening the menu to discover prerequisites. Back, language switch, pet addition, agreement acceptance and reload retain supported nonsensitive intent. A returning client enters the next incomplete step. Completed prerequisites remain recognizable.

## DUX-05 — Intake, pet forms and consistent validation

- [ ] **Dependency** CUX-03 field ownership, conditional requirements, safe draft adapter and field errors.
- [ ] **Files** `assets/care-portal.js::careSettings()/intakeDefaults()/bindCareUi()`, `assets/portal.js::petForm()/profileGroups/petFieldError()`, `assets/myo-launch.js`, `assets/portal.css`, `assets/myo-launch.css`, relevant copy catalogs.
- [ ] Render pet-specific care separately from household emergency contacts and authorization. Prefill canonical saved values and identify which pet each answer applies to.
- [ ] Split the long intake into bounded groups with Save and continue and a visible completion summary. Keep optional or service-specific questions conditional.
- [ ] Put structured field errors next to the fields, use `aria-invalid` and `aria-describedby`, and focus an error summary or first invalid field after submission. Show pending, saved, unsaved and failed-save states.
- [ ] Apply Claude's sensitive-field classifications through markup attributes. Keep home-entry secrets out of saved drafts.
- [ ] **Acceptance** Unsaved nonsensitive feeding text survives reload through the supplied draft adapter, while door/lockbox codes never appear in storage. Zero emergency spending authorization is accepted. Switching service toggles only relevant requirements. Saving household contacts does not make the parent retype each pet's feeding details. Invalid submission preserves values and identifies the exact field in EN/ES.

## DUX-06 — Pricing, stay units and honest financial review

- [ ] **Dependency** CUX-04 for deposit, deadline and cancellation semantics. Unit-label corrections and clear starting-price wording can ship independently.
- [ ] **Files** `assets/home.js`, `assets/price-sheet.js`, `assets/portal.js::bookingForm()/quoteLines()/checkoutSummary()/confirmCancellation()`, `assets/myo-launch.js`, `assets/policy-copy.js`, `assets/myo-copy.js`, `assets/ui-copy.js`, `assets/portal.css`.
- [ ] Replace overnight minute labels with per-night rates and arrival/departure dates. Keep visit duration in minutes.
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

## Delivery order

Ship DUX-01 first. DUX-03 target fixes and DUX-08 local retries can proceed while Claude works on CUX-01/02. Integrate DUX-02/04 after those contracts. Then pair DUX-05 with CUX-03, DUX-06 with CUX-04, and DUX-07/08 with CUX-05/06/07. DUX-09/10 accompany every batch.

Each PR should identify issue IDs, contract versions, EN/ES screenshots, relevant behavioral checks and any unverified device/provider behavior. Keep changes bounded by the slice above. Completion of this plan is a future implementation outcome, not a claim made by this documentation change.
