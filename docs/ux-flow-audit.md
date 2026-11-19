# myo. UX/UI flow audit

Audited November 19, 2026 against main commit `5d139ec9fe3451e8651f7a801648225d83486c71`.

## Executive summary

**Overall flow health is 4/10.** This is a reviewer judgment of task clarity and recovery, rather than a usability-study completion rate. The application supports many operations, but customers and staff have to assemble those operations into a journey themselves. Passing an API test or completing a scripted form does not establish that someone can discover the right sequence.

The three strongest foundations are:

1. The homepage explains the service and provides recognizable service actions. Its responsive brand styling provides a usable visual baseline for the rest of the product.
2. Booking has server-priced line items, a review stage, temporary holds, and actionable prerequisite links. The selected appointment survived the tested intake-save detour on both desktop and mobile.
3. Language choice persisted across the tested public-to-portal navigation. The selected overnight arrival date survived an EN-to-ES switch. Most sampled screens had no axe WCAG A/AA violations and none of the sampled screens had document-level horizontal overflow.

The three largest obstacles are:

1. **Booking has no continuous path through its prerequisites.** The customer discovers a list of blockers after choosing a time, leaves booking for several screens, and receives no overall progress or reliable return action.
2. **Navigation and task hierarchy change across the product.** Customers see duplicate Care details links. Staff see a Care details destination that has no staff screen. Returning customers get acquisition actions ahead of active care. Staff work is distributed across booking, publishing, client records, and settings.
3. **Published financial terms and executable booking behavior disagree.** Policies promise a 50% deposit within 48 hours and a seven-day cancellation policy. The deposit bridge is still a stub, requested bookings owe zero in the ledger, and cancellation uses catalog service settings. Resolve this before public launch.

## Method, scope, and evidence limits

- Read routing, renderers, forms, styles, English/Spanish catalogs, pricing, compliance, ledger, cancellation, diary, and draft code. Relevant sources include `assets/portal.js`, `assets/care-portal.js`, `assets/diary.js`, `assets/drafts.js`, `assets/i18n.js`, `assets/ui-copy.js`, `assets/care-copy.js`, `assets/myo-copy.js`, `assets/myo-launch.js`, `assets/myo-config.js`, and `lib/routes/`.
- Used a disposable Node server through `tests/helpers.mjs`, headless Playwright Chromium, desktop **1440×900**, and touch-enabled mobile **390×844**. The main walkthrough used `MYO_PRICING_MODE=launch`, fictional accounts, published hours, a Rabies requirement, and a short bilingual demo agreement.
- Registered a first-time parent through the UI, added a pet through the five-card form, chose a booking, followed its care prerequisite, saved intake, returned to booking, and tested browser Back.
- Seeded returning-client active visits and a two-night stay through APIs to inspect populated customer and owner screens. For these fixtures and the accelerated meeting-to-visit journey, the test early-start allowance was enlarged. Actual elapsed visit time, real-time device location, and production early-start enforcement were outside that scenario.
- Completed a separate mobile journey through free meeting review/request, paid visit review/request in EN and ES, owner approval, start, structured diary publishing, completion, and customer diary. Intake and the pet were preseeded for this focused journey. Meeting completion was simulated through staff APIs so the paid flow could proceed.
- Captured temporary screenshots and DOM measurements, inspected screenshots, and ran axe-core 4.10.2 with `wcag2a`, `wcag2aa`, and `wcag21aa` tags. Measured effective labels for custom radio/checkbox targets. Document heights include the complete page, not a measurement of task duration.
- Injected availability and session-request failures, submitted an empty registration form, tested unsaved intake across reload, and used Enter, Tab, and Escape on public and portal menus.
- The final five disposable audit runs completed without harness errors. Earlier harness failures were corrected and rerun. One genuine pointer obstruction after saving intake was reproduced separately and is UX-06.
- Temporary evidence labels below identify captured states. Screenshots and harnesses were kept outside the repo. This change adds only the three requested Markdown documents.

**Limits.** This was an expert walkthrough with fictional data, not a study with pet parents. Native phone keyboards, iOS Safari, Android hardware, HEIC capture, real screen readers, live Stripe, outbound email, deployment performance, high-volume data, and the sitter-only role were not exercised. Owner/admin was exercised. Reduced motion was enabled for repeatable snapshots, so motion quality and layout-shift performance remain unmeasured. Normal wrapping was observed, but no CLS score was collected. Automated accessibility results do not certify WCAG conformance.

### Standards interpretation

The project requirement in this audit is **44×44 CSS pixels** for standalone actions. WCAG 2.1 specifies that size under 2.5.5 at **AAA**, with exceptions. It is a stronger product requirement than the requested WCAG 2.1 AA baseline. A small target is recorded as a product failure without automatically declaring an AA failure. Repeated navigation should preserve relative order, and validation should identify errors in text. [W3C target-size guidance](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html), [consistent-navigation guidance](https://www.w3.org/WAI/WCAG21/Understanding/consistent-navigation.html), [error-identification guidance](https://www.w3.org/WAI/WCAG21/Understanding/error-identification.html)

## Chronological walkthroughs

### 1. Landing and discovery

| Step and exact route/component | Desktop observation | Mobile observation | Friction |
| --- | --- | --- | --- |
| Open `/`, `index.html` hero and service cards | Clear service identity and book action. Homepage height was 5,886px in EN. | Service and book actions remained legible at 390px. | The opening copy says Massachusetts while the narrower Springfield/15-mile configuration lives in `assets/myo-config.js` and the policies. Confirm geographic eligibility earlier. UX-15. |
| Inspect service price, `assets/home.js` price labels | Overnight was shown as `$95 / 720 min`. | The same label makes a stay look like a timed visit. | Display nightly units and applicable starting-price language. UX-16. |
| Open menu, then About, FAQ, sample diary and Rates & Policies | Homepage/FAQ, About, sample diary, and rates use different header compositions and destination sets. | Rates and sample diary replace the familiar hamburger with different navigation. | Users must relearn how to move around. UX-14. |
| Open `/myo/launch/`, `assets/myo-launch.js` | Rates, peak dates, estimator, policies, and intake are combined into a 3,932px EN page. | EN 6,112px, ES 6,736px. Spanish CTA wraps to several lines. | The same service is explained through another substantial page and intake surface. UX-09, UX-23. |
| Follow a service link to `/portal/index.html?service=dog-walking#book`, `auth()` | Prices appear above parallel sign-in and registration forms. | ES auth page was 1,348px. New-parent shortcut helps, but sign-in remains ahead of registration in normal page order. | Entry asks the customer to choose a mode and scroll through content before doing the intended task. UX-18. |

Evidence labels include `landing-390`, `landing-menu-1440`, `auth-es-390`, and `rates-es-390`.

### 2. First-time booking and intake

| Step and exact route/component | Desktop observation | Mobile observation | Friction or behavior to retain |
| --- | --- | --- | --- |
| Register, `auth()` submit handler | Service query and `#book` survived registration. | Same behavior. | Retain service intent across authentication. |
| Open booking without pets, `bookingForm()` | A clear Add a pet profile link opens `#pet-intake`. | Same link works. | There is no outline of remaining account, pet, care, meeting, and review steps. UX-03. |
| Add pet, `petForm()` and `showPetCard()` | Five cards permit optional skips. | Next/Skip is usable. Help controls later measured 32×32px. | Pet-level feeding, vaccination, medical and contact text overlaps later intake. UX-09, UX-12. |
| Return to `#book`, select the pet, `updateQuote()` / `updateTotal()` | Four prerequisites appeared with the configured vaccine and agreement. Blocked page height was 1,757px. | Page height was 2,731px. The sticky summary expands into a large obstacle panel before the customer sees much of the form. | Each link says Resolve this requirement. The disabled review action and repeated generic links give no ordered next step. UX-03, UX-05. |
| Inspect date/time and price | Published availability showed same-day starts at a $30 base rate. Selecting the pet produced a $45 total including a $15 last-minute line. | Long time-tile lists increase scrolling before that total. | The public preview does not explain the applicable surcharge or that slots are availability previews subject to prerequisites. UX-15. The quote correctly itemizes it once requested. |
| Follow intake/agreement to `#care`, `careSettings()` | Agreement, open intake groups, and home entry share a long screen. EN 2,671px, ES 2,691px in the first-time fixture. | EN 3,050px, ES 3,206px. Saving is at the end of the form. | No per-group completion, primary next task, or Return to booking action. UX-03, UX-09. |
| Save intake and try to reopen menu | Saved notice intercepted hamburger clicks until its dismiss button was used. | The matching fixed overlay is a mobile layering risk. The pointer obstruction was directly reproduced on desktop. | UX-06. |
| Return to `#book`, then browser Back | Selected appointment key was unchanged after saving. Back returned to `#care`. | Same preservation and Back behavior. | Preserve these behaviors while adding explicit continuation. No evidence of appointment loss on this tested path. |
| Fill intake without saving, reload; repeat after navigating away | Typed feeding text disappeared. | Same loss. | `createDrafts()` captures `data-action` forms, while care forms use `data-care-action`. Language rerender preservation does not supply reload recovery. UX-04. |
| Choose a stay, `stayFields()` / `stayCalendar()` | Two-month calendar selection worked. Arrival survived EN-to-ES. | Day buttons measured about 40×44px. Selected dates triggered axe contrast findings in both languages. | UX-11, UX-12. Preserve date selection across translation. |
| Book a free meeting, then paid review, `checkoutSummary()` | Source review confirms the same review renderer is shared. | UI journey reached both reviews and sent requests. Free review says No charge. Paid review remains a request to Myomi. | There is no executable 50% deposit step matching the policies. Review and ledger lifecycle must agree. UX-01. |

Observed requirement list for a new dog parent was Rabies record, agreement, intake, and a completed complimentary meeting for that new booking. The per-booking meeting rule is executable behavior in launch mode, not merely a first-customer welcome. The plans require the owner to confirm that rule before changing it.

### 3. Returning client and residency updates

| Step and exact route/component | Desktop observation | Mobile observation | Friction |
| --- | --- | --- | --- |
| Open authenticated `/portal/index.html`, `clientHome()` | Five generic destination cards and a seven-day calendar. | Book a free Meet & Greet and Book a visit lead the screen even with active care. Calendar begins near/below the first viewport. | No active-care summary or latest update leads the page. UX-07. |
| Open `#upcoming`, `bookingCard()` | Booking details and actions work, but information is repeated on the home calendar and the diary. | Cards require more vertical scanning to locate the relevant visit/action. | Use a stable visit destination shared by all entry points. UX-08, UX-23. |
| Open `#diary`, `diary()` / `renderDiaryVisits()` | Stay events are grouped by night. | Spanish diary wraps without document overflow. A native filter and Refresh updates precede the feed. | Latest update and freshness do not appear on the home dashboard. UX-07, UX-13. |
| Publish a new event while this diary remains open | New content was absent after a two-second observation, then appeared after Refresh updates. | Same result. | Source shows refresh on entry/manual action and no diary polling subscription. Live/residency expectations need a freshness contract and an explicit last-checked status. UX-13. The two-second probe alone is not a latency benchmark. |
| Switch EN/ES | Language persisted, customer-entered names and notes remained literal. | No document overflow in tested translated diary. | Preserve names and client notes as entered. UX-21 concerns system strings only. |
| Open Account | Password change, sessions, preferences and package-related content share a destination. | About 1,255px in the fixture. | Sign-in offers no password recovery path, so a returning client who forgets credentials cannot self-serve. UX-22. |

### 4. Owner/admin operations

| Step and exact route/component | Desktop observation | Mobile observation | Friction |
| --- | --- | --- | --- |
| Open staff home, `staffHome()` | Task cards show request counts and active-visit counts. | An owner still opens a separate queue and then finds the visit. | Counts help, but a priority list with direct actions is missing. UX-07, UX-08. |
| Open hamburger, `portal/index.html` plus `render()` | Static Care details is exposed after role-specific links. | Same. | Staff click `#care` and silently see staff home while the URL remains `#care`. Customer menu contains Care details twice. UX-02, UX-20. |
| Open `#upcoming`, `bookingCard()` | Populated fixture was 3,067px. | 3,018px with multiple visits. | Profiles, payment controls, change controls, entry tools and operational actions compete within a card list. UX-08. |
| Start visit, `statusForm()` | Shared handler changes destination to `#diary`. | UI journey successfully moved into publishing. | The selected visit does not become an exclusive workspace. With multiple active visits, publishing forms are repeated. UX-08. |
| Publish structured update, `eventForm()` / `reportInputs()` | Structured answers are available. | Activity grid and notes precede Publish. Complete remains on another screen. | Publication succeeds, but the next operation requires navigation back through the queue. UX-08. |
| Inspect published answers, `renderDiaryVisits()` | Staff-hidden No answer caused serious axe `color-contrast`. | Same failure after a real UI publish. | `.diary-field-hidden` uses opacity .55 and strike-through. Retain the visibility label with readable text. UX-11. |
| Open `#settings`, `adminSettings()` / `staffComplianceSettings()` / staff panel | Fixture heights ranged 3,636–3,708px. | EN 5,025–5,073px and ES 5,215–5,263px across fixtures. | Hours, exceptions, price configuration, compliance, agreements, backup and staff administration share one long destination. UX-17. |
| Open `#financials`, `showFinancials()` | Intro still says the portal does not track collected payments/refunds even though ledger and payment controls exist. | Same system copy. | This undermines trust about what the balance represents. UX-21. |
| Complete visit and open customer diary | API and shared views preserve summary/departure information. | Actual UI journey published, completed, and displayed the update to the customer. | Retain explicit completion validation and private diary visibility. |

### 5. Empty, loading, error, and navigation states

1. **Empty booking.** No pet gives a useful add-profile link. Unpublished catalog/hours use separate empty messages in `bookingForm()` and `showPriceSheet()`. Overnight no-availability hides Check again in `stayFields()`, so its retry behavior differs from visits. UX-10.
2. **Availability outage.** Fulfilling `/api/availability` with 503 produces Rates and times are unavailable right now, with no local Retry control. Tested at both sizes. UX-10.
3. **Startup outage.** Aborting `/api/session` produces The care portal needs a running myo. server, with no retry. A transient connection failure is described as infrastructure setup trouble. UX-10.
4. **Invalid registration.** Submitting empty registration moved focus to Name and supplied Complete this required field in both sizes. Retain that behavior. The five-card pet flow also has dedicated inline errors, but other forms rely on native tooltips or generic form status. UX-19 is consistency work.
5. **Unknown route.** Loading `#not-a-route` silently renders client home without correcting the URL. Staff Care details reproduces the same class of mismatch. UX-20.
6. **Keyboard menu.** Enter opened public and portal menus. Tab reached their links. Escape closed each and returned focus to its toggle. Retain these. The portal shell has no skip link. End-to-end screen-reader operation remains unverified. UX-24.
7. **Draft recovery.** Booking survived the tested save and Back path. Unsaved care intake did not survive reload. Do not generalize the successful booking draft test to all forms. UX-04.
8. **Notifications.** A Saved toast has a dismiss control, but it obstructs a core navigation control and stays until dismissal on the reproduced path. UX-06.

## Prioritized issues

P0 blocks a truthful public launch or successful core transaction. P1 materially increases task failure or confusion. P2 improves consistency, clarity, or comfort. Primary owners refer to the bounded tasks in the two plans.

| ID | Severity | Heuristic / evidence | Affected files and component | Recommended fix and task |
| --- | --- | --- | --- | --- |
| UX-01 | P0 Blocker | Trust, visibility of system status. Published deposit/cancellation terms disagree with executable lifecycle. Source and mobile paid review. | `assets/myo-launch-backend.js::beginDepositCheckout()`, `assets/myo-config.js`, `assets/myo-copy.js`, `lib/ledger.mjs::amountDue()`, `lib/cancellation.mjs`, `lib/routes/payments.mjs`, `assets/portal.js::checkoutSummary()` | Claude CUX-04 supplies a coherent financial contract. Codex DUX-06 renders those authoritative terms. |
| UX-02 | P1 High Friction | Consistency and wayfinding. Duplicate customer Care details, inappropriate staff link. Browser and source. | `portal/index.html` static nav, `assets/portal.js::render()` | Codex DUX-01 removes the duplicate and wrong-role links immediately. CUX-01 then supplies the route capability registry for DUX-02. |
| UX-03 | P1 High Friction | Recognition over recall, progress visibility. Prerequisites are revealed as detours after time selection. Browser. | `assets/portal.js::bookingForm()/updateTotal()`, `assets/care-portal.js::blockerHtml()/careSettings()` | Claude CUX-02 models ordered progress and return intent. Codex DUX-04 builds the guided UI. |
| UX-04 | P1 High Friction | User control, error prevention. Unsaved intake feeding text is lost on reload. Browser. | `assets/drafts.js::createDrafts()`, `assets/care-portal.js` form helper and intake | Claude CUX-03 extends safe draft coverage with explicit sensitive exclusions. Codex DUX-05 shows saved/unsaved state. |
| UX-05 | P1 High Friction | Cognitive load, mobile reach. Four blockers make the sticky summary a large panel occupying most of a mobile viewport. Screenshot. | `assets/portal.js::updateTotal()`, `assets/care-portal.js::blockerHtml()`, `assets/portal.css [data-booking-summary]` | Codex DUX-03 keeps the dock compact and puts an ordered prerequisite summary in normal flow. |
| UX-06 | P1 High Friction | User control, obstruction. Saved notice intercepts desktop menu pointer events after intake save. Browser click log. | `assets/portal.css::.portal-feedback.is-notice`, `assets/portal.js::showPublicationFeedback()` | Codex DUX-01 relocates/bounds feedback so navigation and actions remain operable. |
| UX-07 | P1 High Friction | Match to current task. Returning home prioritizes another meeting/new booking ahead of active care. Browser. | `assets/portal.js::clientHome()/staffHome()/weekCalendar()` | CUX-05 derives role-appropriate next actions; DUX-07 prioritizes active care and due work. |
| UX-08 | P1 High Friction | Context and task continuity. Run-visit actions are spread across queue, publishing and records. Browser. | `assets/portal.js::bookingCard()/publishingDesk()/eventForm()`, `assets/care-portal.js::staffCareTools()/clientRecord()` | CUX-01/CUX-05 provide stable visit routes and state; DUX-07 integrates one visit workspace. |
| UX-09 | P1 High Friction | Minimal input, logical grouping. Pet profiles, required care intake and public launch intake overlap. Source and UI. | `assets/portal.js::profileGroups/petForm()`, `assets/care-portal.js::intakeDefaults()/careSettings()`, `assets/myo-launch.js`, `lib/routes/intake.mjs` | CUX-03 defines field ownership and conditional requirements; DUX-05 groups and prefills inputs without silent data migration. |
| UX-10 | P1 High Friction | Recovery and plain language. Rates/session errors lack local retry; overnight availability has different recovery. Fault injection and source. | `assets/price-sheet.js::showPriceSheet()`, `assets/portal.js::refresh()/stayFields()`, `assets/care-portal.js::loadCareSection()` | Codex DUX-08 supplies visible pending/empty/error/retry states and retains task context. |
| UX-11 | P1 High Friction | WCAG 1.4.3 contrast. Axe serious findings on hidden staff answer chips and selected calendar dates in populated states. | `assets/portal.css::.diary-field-hidden/[data-stay-date][aria-pressed=true]`, `assets/diary.js::renderFields()` | Codex DUX-01 fixes normal-text contrast and uses text/icon treatment to indicate status. |
| UX-12 | P1 High Friction | Project 44px touch requirement. Calendar ~40×44, pet help 32×32, portal logo ~87×34 at 390px. Measurements. | `assets/portal.css::.stay-day-grid/.pet-field-tip`, `assets/home.css::.wordmark`, `assets/myo-launch.css` | Codex DUX-03 reduces calendar nesting and enlarges hit areas. Rates anchor measured ~41×44 also needs padding. |
| UX-13 | P1 High Friction | Freshness and expectation. Open diary needs manual refresh; no latest-checked status. Browser probe plus source. | `assets/portal.js::refreshDiaryView()/hashchange`, `lib/routes/diary.mjs` | Claude CUX-06 supplies bounded refresh/reconciliation. Codex DUX-08 exposes stale, updating, current, and disconnected states. |
| UX-14 | P1 High Friction | Consistent navigation. Homepage/FAQ, About, sample diary, rates and portal vary composition/order. Browser and markup. | `index.html`, `myo/about/index.html`, `myo/safety_first_faq/index.html`, `myo/client_journal_cute_lively/index.html`, `myo/launch/index.html`, `portal/index.html` | Codex DUX-02 applies one branded header/menu pattern while retaining role-appropriate destinations. |
| UX-15 | P1 High Friction | Price/eligibility transparency. Base public preview omits selected-date surcharge; home geography is broad. Browser and config. | `assets/price-sheet.js`, `assets/home.js`, `assets/myo-config.js`, `assets/myo-launch.js` | CUX-04 defines quote semantics; DUX-06 labels estimates, nightly units, surcharges and service-area eligibility clearly. |
| UX-16 | P1 High Friction | Domain language. Overnight advertised as 720 min. Browser; same unit pattern in service choices. | `assets/home.js`, `assets/price-sheet.js`, `assets/portal.js::bookingForm()/checkoutSummary()` | Codex DUX-06 displays per-night pricing and arrival/departure dates consistently. |
| UX-17 | P1 High Friction | Hierarchy, progressive disclosure. Owner settings exceeds 5,000px on mobile. Browser. | `assets/portal.js::adminSettings()/showStaffPanel()`, `assets/care-portal.js::staffComplianceSettings()` | DUX-07 builds grouped admin destinations from the CUX-01 route contract. |
| UX-18 | P2 Polish | Mode clarity. Competing sign-in/create-account forms and rate preview obscure the chosen entry task. Browser. | `assets/portal.js::auth()`, `assets/portal.css::.auth-jump` | DUX-04 gives each auth mode one primary action and carries the pending booking forward. |
| UX-19 | P2 Polish | Error identification. Pet wizard has inline errors; other forms use inconsistent native/form-level messages. Source; empty registration focus passed. | `assets/portal.js::petFieldError()/invalid listener`, `assets/care-portal.js::bindCareUi()`, `lib/validate.mjs` | CUX-03 standardizes field-error payloads; DUX-05 provides linked inline errors and focus summaries. |
| UX-20 | P2 Polish | Wayfinding and recovery. Invalid hashes silently show home without URL repair. Browser. | `assets/portal.js::showSection()`, `assets/care-portal.js::loadCareSection()` | Claude CUX-01 returns explicit not-found/forbidden results and canonical routes; Codex DUX-02 renders recovery. |
| UX-21 | P2 Polish | Trust and bilingual consistency. Financials intro denies payment tracking; service-count text concatenates English visit/visits. Source-reviewed branch. | `assets/portal.js::showFinancials()/financials section`, `assets/ui-copy.js`, `assets/i18n.js` | DUX-09 corrects system copy and uses catalog plurals. Exercise paid/completed fixtures in ES. |
| UX-22 | P1 High Friction | Account recovery. Sign-in has no forgotten-password action. Source/visible auth. | `assets/portal.js::auth()`, `lib/routes/account.mjs`, `lib/auth.mjs`, `lib/outbox.mjs` | Claude CUX-07 defines secure recovery and provider dependency; Codex DUX-08 renders the available recovery path honestly. |
| UX-23 | P2 Polish | Hierarchy and consistency. Repeated Welcome plus section headings, generic destination cards, and stacked forms bury the current job. Screenshots. | `assets/portal.js::render()/dashboardActions()`, `assets/care-portal.js`, `assets/portal.css`, `assets/myo-launch.css` | DUX-07 uses a compact page title, summary and one primary action per task group. |
| UX-24 | P2 Polish | Keyboard efficiency. Portal shell lacks skip navigation; menu keyboard behavior already passes sampled checks. | `portal/index.html`, `assets/portal.css`, `assets/portal.js::showSection()` | DUX-02 adds a focusable main target and consistent skip link, preserving Escape/focus return. |
| UX-25 | P2 Polish | Verification coverage. Existing 24px target threshold and mostly happy-path snapshots miss 44px and populated-state defects. | `tests/browser/a11y-smoke.mjs`, `tests/browser/care-smoke.mjs`, `tests/browser/portal-smoke.mjs` | DUX-10 covers real menu click paths, selected dates, hidden answer chips, unsaved care, and 44px effective hit areas. |

## Remediation sequence and ownership

1. Codex DUX-01 fixes independently reproducible menu, overlay and contrast defects.
2. Claude CUX-01 and CUX-02 publish navigation and booking-state contracts. Codex DUX-02/03/04 then integrate the shell and guided booking.
3. Claude CUX-03 and CUX-04 establish draft/field and financial truth. Codex DUX-05/06 consume those contracts.
4. Claude CUX-05/06 enable visit workspaces and update freshness. Codex DUX-07/08 finish the dashboard and recovery surfaces.
5. CUX-07 and DUX-08 complete account recovery when the delivery mechanism is available. DUX-09/10 verify bilingual copy and end-to-end accessibility throughout.

The implementation files are exclusively assigned in the [Codex plan](plans/codex-ux-plan.md) and [Claude plan](plans/claude-ux-plan.md). A shared issue can require an API task and a UI task, but each file and implementation responsibility has one owner. The audit itself changes no application code.
