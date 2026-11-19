# myo. UX/UI flow audit

Audited November 19, 2026 against main commit `5d139ec9fe3451e8651f7a801648225d83486c71`.

## Reconciliation with Claude's audit

This document combines Codex's broader customer/admin walkthrough with Claude's direct-booking audit committed as `b89aa1f`. Both inspected application build `5d139ec`. Claude's complete original text is preserved in the attributed appendix below. His 5/10 and Codex's 4/10 are independent reviewer scores with different scopes. The 4/10 assessment below includes populated staff screens, recovery and update freshness.

The active issue registry is UX-01 through UX-30 below. Claude's numbered findings remain traceable through this crosswalk.

| Claude original issue | Active issue | Reconciliation |
| --- | --- | --- |
| #1, #14 | UX-30, UX-07 | Per-booking completed meetings obstruct the first request and repeat care. Changing scope, expiry or request order requires the owner's decision. |
| #2, #3 | UX-01 | Deposit, cancellation acknowledgment and executable payment states need one contract. |
| #4 | UX-26 | Add structured service contact/address and an eligibility check. A ZIP centroid is an estimate and cannot establish exact address eligibility at a radius boundary. |
| #5 | UX-27 | Guest eligibility and public quote before account creation remain explicit roadmap work. |
| #6, #7, #15 | UX-15, UX-28 | Supply short-notice, peak, capacity and meeting-notice metadata before selection. The proposed 24-hour meeting rule is unapproved. |
| #8 | UX-09 | One canonical intake with progressive save. Public intake redirects only after a replacement preserves useful work. |
| #9 | UX-29 | Add a confirmation destination, next actions and client notification capability. |
| #10, #11, #18 | UX-15, UX-27 | Make the booking start and service area apparent in the hero, and align How It Works with the implemented flow. |
| #12, #20 | UX-05 | Compact the dock and progressively disclose long time lists. |
| #13, #19 | UX-16 | Use nightly units, meeting-specific language and consistent timezone wording. |
| #16 | UX-12 | Apply the project's 44px target requirement. |
| #17 | UX-02 | Remove duplicate and wrong-role links. |

**Evidence reconciliation.** Claude's source describes a price-free opening viewport and a very long unfiltered sign-up screen. The homepage also has async price badges farther down, and Codex measured a shorter service-filtered sign-up screen. These are different states, not competing measurements of one fixture. Claude's passing baseline accessibility suite remains a valid historical result; the expanded populated-state checks below additionally found selected-date and hidden-answer contrast defects.

**Policy reconciliation.** Claude proposed meeting coverage once per client/new pet/12 months and a deposit deadline beginning after owner acceptance. Current copy says a meeting for every booking and a deposit deadline after the request. Neither proposed default is approval to change policy. The active plans require recording the owner decision, then applying it consistently to rules, displayed terms and tests.

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
| UX-26 | P0 Blocker | Service fulfillment and eligibility. Claude identified no dedicated client phone or structured service address/ZIP; the configured radius is not checked. Source finding, carried forward for backend verification. | `lib/routes/account.mjs`, `lib/routes/intake.mjs`, `assets/myo-config.js` | CUX-08 adds structured contact and eligibility outcomes; DUX-11 renders early checking and address collection. Confirm boundary cases with Myomi. |
| UX-27 | P1 High Friction | Discovery and commitment order. A real quote requires an account, while the opening hero offers a secondary information action and the rates page uses another entry path. Claude walkthrough plus source. | `index.html`, `assets/portal.js::auth()`, `lib/routes/bookings.mjs`, `assets/myo-launch.js` | CUX-08 adds a bounded guest quote contract. DUX-11 provides a visible preview-first entry; DUX-04 carries it into account creation. |
| UX-28 | P1 High Friction | Error prevention and price visibility. Capacity is checked at quote time, day choices lack full/peak/notice flags, and meeting notice has no explicit configuration. Claude source findings; a full-capacity day was not independently seeded in Codex's walkthrough. | `lib/scheduling.mjs`, `lib/pricing.mjs`, `lib/routes/portal.mjs`, `assets/portal.js::updateQuote()` | CUX-09 supplies authoritative day/night metadata and policy-backed defaults; DUX-03/06 present it. |
| UX-29 | P1 High Friction | Closure and next action. Request submission leads to a booking card/status message without a dedicated next-steps view. Client delivery remains unconfigured. Both audits. | `assets/portal.js` submit handler, `lib/routes/bookings.mjs`, `lib/outbox.mjs` | CUX-05 includes confirmation timeline/next actions and notification capability; DUX-12 renders the result. |
| UX-30 | P0 Blocker | First-request completion. Each paid request requires its own already-completed physical meeting, so a new parent cannot finish the intended paid request in the initial session. Both audits and launch-mode source. | `lib/compliance.mjs::availableMeet()/blockers()`, `lib/routes/bookings.mjs`, `lib/db.mjs`, `assets/myo-config.js` | CUX-02 models pending requirements and implements the approved meeting scope/request order; DUX-04/07 render the next action. The suggested once-per-client rule remains a proposal. |

## Remediation sequence and ownership

1. Codex DUX-01 fixes independently reproducible menu, overlay and contrast defects.
2. Claude CUX-01 and CUX-02 publish navigation and booking-state contracts. Codex DUX-02/03/04 then integrate the shell and guided booking.
3. Claude CUX-03 and CUX-04 establish draft/field and financial truth. Codex DUX-05/06 consume those contracts.
4. Claude CUX-05/06 enable visit workspaces and update freshness. Codex DUX-07/08 finish the dashboard and recovery surfaces.
5. CUX-08/09 and DUX-11 preserve Claude's guest-first, service-area and availability work. CUX-05 and DUX-12 add explicit request confirmation. Their route/intent contracts build on CUX-01/02.
6. CUX-07 and DUX-08 complete account recovery when the delivery mechanism is available. DUX-09/10 verify bilingual copy and end-to-end accessibility throughout.

The implementation files are exclusively assigned in the [Codex plan](plans/codex-ux-plan.md) and [Claude plan](plans/claude-ux-plan.md). A shared issue can require an API task and a UI task, but each file and implementation responsibility has one owner. The audit itself changes no application code.

---

## Preserved Claude source from b89aa1f

The original November 19 document is retained below for attribution, evidence, and continuity of its issue and ticket IDs. The reconciled sections above are the active execution plan. Proposed policy defaults and UI ownership in this source are subject to the reconciliation above.

<details>
<summary>Read Claude's complete original document</summary>

<!-- claude-source-b89aa1f-start -->
# Direct-booking UX and flow audit: myo.

**Date:** November 19, 2026. **Build:** `main` at `5d139ec` ("Connect launch pricing and complete care portal integrations"). **Runtime:** Node server, default `launch` pricing mode, fresh database; staff published daily hours 08:00–18:00 and the four services through the API. **Browser:** Playwright Chromium at 1440×900 (desktop) and 390×844 (mobile, touch). **Personas:** a first-time pet parent on mobile, and the same person returning to check bookings. No application code was changed for this audit.

The benchmark is the five-step direct-booking flow in the brief: (1) landing and eligibility, (2) service, dates and live quote, (3) lightweight contact plus progressive intake, (4) summary, terms and deposit, (5) confirmation and next action.

## 1. Executive summary

**Flow health: 5/10.** The engine underneath is strong. The flow on top is a *portal* (account first, then a dashboard of sections), not a *booking funnel*. A first-time client must create an account, add a pet profile, complete a separate 11-field intake, book and attend a Meet & Greet in person, and only then can they request the visit they came for. The real price, the deposit and the cancellation terms are not visible at the moment of commitment.

| Benchmark step | Match | One-line verdict |
|---|---|---|
| 1. Landing & eligibility | Partial | Clear "who" and services; no price, no service area, no in-hero booking CTA |
| 2. Service, dates & live quote | Partial | Excellent itemized server quote, but behind an account wall and a pet profile; defaults to a last-minute slot |
| 3. Contact + progressive intake | Weak | Pet profile is a 5-step stepper; the 11-item care intake is one long form; duplicated questions; no address or radius |
| 4. Summary, terms & deposit | Missing | Receipt-style review exists, but no deposit, no 48-hour rule, no cancellation terms, no acknowledgment |
| 5. Confirmation & next action | Weak | A one-line toast and a card; no "what happens next", no Meet & Greet guidance, no client email |

**Top 3 strengths**
1. **Server-authoritative, itemized live quote.** `POST /api/quote` (`lib/routes/bookings.mjs`, `bookingSelection()`; `lib/pricing.mjs` `priceBooking()`) returns lines such as `Dog walking $30.00` + `Last-minute fee $15.00`, refuses stale totals (`price_changed`), and returns *blockers* with "Resolve this requirement" links (`blockerHtml()` in `assets/care-portal.js`). This is better than either benchmark competitor.
2. **Bilingual parity and accessibility discipline.** Every portal phrase goes through `t()` with English and Spanish in `assets/ui-copy.js`, `assets/care-copy.js` and `assets/i18n.js`, enforced by `tests/i18n.test.mjs`. The axe suite (`tests/browser/a11y-smoke.mjs`) passes, and no page overflowed horizontally at 390 px in either language.
3. **Momentum details already right in places.** The pet profile is a true stepper ("Step 1 of 5", one required pair of fields, optional details collapsed, draft persistence via `assets/drafts.js`), and time holds with expiry recovery protect the chosen slot (`checkout-hold`, `assets/portal.js` `startHoldTimer()`).

**Top 3 blockers**
1. **The first paid booking cannot be requested until an in-person Meet & Greet has been *completed*, and the rule repeats for every booking.** `blockers()` in `lib/compliance.mjs` adds `meet_required` unless `availableMeet()` finds a completed Meet & Greet not yet used by another booking; each paid booking consumes one (`bookings.meet_booking`, unique index in `lib/db.mjs`). The copy confirms it: "A complimentary Meet & Greet is required for each new booking." (`assets/care-copy.js`, `assets/myo-copy.js` `meetBody`). Returning clients hit the same wall on every booking. Rover normalizes a Meet & Greet for *new clients*; it never blocks repeat bookings.
2. **No deposit, no 48-hour rule, no terms at commitment.** `myoConfig.booking.depositRatio` (0.5) and `depositHours` (48) in `assets/myo-config.js` are only used by the public calculator on `/myo/launch/`. The portal review (`checkoutSummary()` in `assets/portal.js`) shows "Visit total" and "Send booking request" with no deposit, no cancellation terms and no acknowledgment. `launchBackend.beginDepositCheckout()` in `assets/myo-launch-backend.js` is a `TODO` that throws.
3. **No eligibility check and an early account wall.** No address or ZIP is collected anywhere (no field in `lib/routes/account.mjs`, `lib/routes/intake.mjs` or `myoConfig.intakeFields`), so `business.radiusMiles: 15` is never checked. `/portal/index.html#book` signed out shows sign-in and registration forms first (`auth()` in `assets/portal.js`). `/api/quote` requires a signed-in customer, so nobody can see a real total for a real date without an account.

## 2. Step-by-step flow audit

### Step 1: Landing & eligibility (`/index.html`, `/myo/launch/index.html`)

**Desktop (1440×900).** Above the fold: the wordmark, EN/ES toggle, a strong **Book a Visit** button in the header, the headline "Your pet's second best friend.", "Personalized, loving pet care in Massachusetts — by Myomi.", three service pills, and one hero button, **See How It Works** (`index.html` lines 66–95). Who and what are clear in about five seconds.
- **Missing:** any price (prices appear only far down the 5,886 px page, and in full only on `/myo/launch/`), the service area ("Massachusetts" is a state; the business serves a 15-mile radius of Springfield, `myoConfig.business`), and a primary booking CTA *inside* the hero. The only hero button is secondary and scrolls to "How It Works".
- "How It Works" (`#how`) says "Tell us about your pet → Let's get acquainted → Enjoy", which does not match the real six-stage flow.

**Mobile (390×844).** The header shrinks **Book a Visit** to a paw icon in an orange circle (`.header-actions .booking-label` is visually hidden below the mobile breakpoint, `assets/home.css` line 185). The icon has an accessible name but no visible label, so a stressed first-time user sees no booking CTA above the fold, only **See How It Works** (screenshot: `mobile-1-landing`). The EN/ES toggle is visible and persistent: good. The wordmark link is 87–108 × 34–40 px, under the 44 px target.

**Rates & Policies (`/myo/launch/`).** It holds the real rate cards, peak calendar, 16 policy areas, an estimate calculator (shows deposit) and a **second, public care-intake form** (`#intake-form`, posting to `/api/intake` through `assets/myo-launch-backend.js`). It is the only place a deposit is mentioned, and it is a separate page from booking. A user who fills its intake form must still fill the portal's.

**Spanish.** The landing translates fully, and the page grows by 244–353 px with no overflow. No issues found at 390 px.

### Step 2: Service, dates & live quote (`/portal/index.html#book`)

**Signed out (both sizes).** The page shows "Sign in or create an account to request a visit.", a **Prices & availability** sheet (`showPriceSheet()` in `assets/price-sheet.js`) and the sign-in and registration forms. On mobile the registration form starts at about 1,400 px (page height 1,864 px), below four price cards.
- The price sheet shows "Dog walking 30 min · $30.00" next to times on *today* (for example "Nov 19, 2026, 8:00 AM"), which actually cost $45.00 with the last-minute fee. That is a price surprise one step later.
- "Overnight pet sitting … No available times in the next two weeks." is false: overnights are chosen by night, not by start time (`bookableStarts()` in `lib/scheduling.mjs` skips overnight services).
- A real quote requires an account: `POST /api/quote` is `access:'user'`.

**After registration.** The client lands on "Request care: Add your pet to continue booking a visit." (`bookingForm()`), a dead end that requires the pet profile first. The pet stepper takes **5 submit taps** for 2 required fields (`profileGroups` in `assets/portal.js`: About, Medical, Dietary, Emergency contacts, Daily care), then returns to `#book` with "Pet added. You can continue booking."

**Booking form.** Service cards, pets, a week of day chips with **Earlier/Later dates**, up to 20 time chips grouped Morning/Midday/Evening, and care notes. The live quote summary is sticky (`.portal [data-booking-summary] { position: sticky }` in `assets/portal.css`).
- **Default selection is the earliest time**, which is inside the 3-day notice window, so the first price the client sees is **$45.00** (base $30 + last-minute $15) instead of the advertised $30 (screenshot `mobile-4b-quote`).
- **Blockers appear only after selecting a pet:** "Complete your care intake before requesting this service." and "Complete a complimentary Meet & Greet for this new booking." **Review booking** is disabled. The first paid request is impossible in this session.
- **Mobile layout:** the sticky summary grows to about 300 px with two blockers and covers the service cards and day chips beneath it; the "Overnight pet sitting · 720 min · $95.00" card is clipped under it. "720 min" is a confusing way to describe an overnight.
- **Capacity:** the 10-visits-per-day limit (`checkLaunchCapacity()` in `lib/pricing.mjs`) is enforced in the quote, but the slot list never hides a full day, so customers learn it from an error after choosing.
- **Peak pricing:** applied in the quote (`priceBooking()`, launch mode), but nothing marks peak dates in the day chips before selection.

**Desktop** behaves the same; the form fits without the overlay problem, and **Review booking** is at the top of the summary.

### Step 3: Contact + progressive intake (`#pet-intake`, `#care`, `/myo/launch/#intake`)

- **Contact.** Registration asks for name, email and a 12+ character password (`auth()`). There is no phone number and no address anywhere in the product, so the radius cannot be checked and Myomi cannot call or find the home.
- **Intake is split across three surfaces, with overlap:**
  1. The pet profile stepper (`petForm()`, 5 cards, 19 optional fields: breed, sex, age, weight, health, medication, heartworm, allergies, vaccinations, food, portion, feeding, restrictions, vet, vet phone, emergency contact and phone, temperament, notes).
  2. The care intake under **Care details** (`careSettings()` in `assets/care-portal.js`, saved by `lib/routes/intake.mjs`): all 11 `myoConfig.intakeFields` as **one form, 11 textareas/inputs, 2,700 px tall on mobile**. Groups are collapsible ("Your pets and routines", "Health and emergency contacts", "Emergency authorization") but there is no progress indicator, a single **Save care intake** at the bottom, and a service picker at the top that asks again what the client is booking.
  3. The public intake form on `/myo/launch/#intake`.
- **The same facts are requested two or three times:** feeding, health/allergies, medication, behavior, vaccinations, vet and emergency contact all appear in both the pet profile and the care intake. "Pet names, ages, and species" is pre-filled with "Biscuit, Dog" as free text, while the structured pet record already exists.
- **Ergonomics:** the "?" help toggles on the pet form are 32×32 px (`details.pet-field-tip > summary`, "Help for …"), below 44 px. Inline validation on the pet form is good (`validatePetFields()`). The intake has a server-side check only.

### Step 4: Summary, terms & deposit (review inside `#book`)

The review card (`checkoutSummary()`) is receipt-like and clean: service, sitter, pet, appointment, duration, itemized lines (`quoteLines()`), total, "Time held until 7:16 AM ET", **Edit booking** and **Send booking request**.
- **No deposit amount, no balance, no 48-hour payment window.** Main has hosted checkout and a ledger (`lib/routes/payments.mjs`), but nothing ties a 50% deposit to a request.
- **No cancellation terms.** The cancellation fee preview exists only inside the *cancel* dialog (`confirmCancellation()`, `GET /api/cancellation-preview`). The launch policy (7 days, retain 50% of the deposit; `myoConfig.booking.cancellationDays`, `flags.lateCancellationDepositRetentionRatio`) and the per-service percentage model from C3.2 (`lib/cancellation.mjs`, `services.cancel_fee_percent`) disagree, and neither is shown before commitment.
- **No acknowledgment checkbox.** The versioned service agreement is a separate blocker (`agreement_required`) handled on the **Care details** page, not in the summary.
- **Meet & Greet review** says "Visit total: No charge", which is correct, but it doesn't explain that the visit being requested is a meeting, not care.

### Step 5: Confirmation & next action (`#upcoming`)

After **Send booking request**, the app navigates to **My bookings** with the feedback line "Request sent. Myomi still needs to confirm your appointment." and a card "Meet & Greet · Waiting for Myomi" with **Cancel booking** and **Reschedule** (screenshot `mobile-7-confirmation`).
- There is no confirmation screen, no reference, no timeline (requested → confirmed → deposit → visit), and no next action. Nothing says "complete your care intake" (the actual next blocker) or "after your Meet & Greet, come back to book your walk".
- The client receives no email. The outbox only queues `request_received` for staff (`lib/routes/bookings.mjs`), and no provider is connected.
- The Meet & Greet is offered as soon as 50 minutes away (today 8:00 AM at a 07:06 run). There is no minimum notice for a meeting at someone's home.

### Returning client (`/portal/index.html`)

The client home (`clientHome()` in `assets/portal.js`, line 779) shows six task tiles plus a 7-day calendar. The first tile is "Book a free Meet & Greet: A complimentary Meet & Greet is required for each new booking." For a returning client this misleads, and it pushes the real primary action (**Book a visit**) to second place.
- **Book again** exists on completed cards (`data-book-again`), which is good.
- The portal menu lists **Care details** twice (`#portal-links` plus the hard-coded link in `portal/index.html`), and shows it even to signed-out visitors and staff.

## 3. Prioritized issues

Severity: **P0 Blocker** stops or misleads a first booking; **P1 High friction** adds avoidable work or doubt; **P2 Polish**.

| # | Sev | Step | Heuristic | Issue | File(s) | Recommended fix |
|---|---|---|---|---|---|---|
| 1 | P0 | 2, 5 | Flexibility; match with real world | Every paid booking needs its own *completed* Meet & Greet; first-timers can't request care until after an in-person meeting | `lib/compliance.mjs` (`availableMeet`, `blockers`), `lib/db.mjs` (`meet_booking`), `assets/care-copy.js`, `assets/myo-copy.js` | Meet & Greet once per client (and per new pet), allow the first visit request alongside it, confirm only after it happens (Claude CU4; policy confirmation needed) |
| 2 | P0 | 4 | Visibility; error prevention | No 50% deposit, no 48-hour rule, no balance on the review | `assets/portal.js` `checkoutSummary()`, `assets/myo-launch-backend.js`, `lib/routes/payments.mjs` | Deposit state machine and quote fields (CU5); UI rows (X-U7) |
| 3 | P0 | 4 | Visibility of policies | Cancellation terms not shown or acknowledged before requesting; two conflicting cancellation models | `lib/cancellation.mjs`, `assets/myo-config.js`, `assets/policy-copy.js`, `checkoutSummary()` | One policy source, terms returned with the quote, acknowledgment recorded on request (CU6) |
| 4 | P0 | 1, 3 | Error prevention | No address or ZIP, so the 15-mile radius is never checked | `lib/routes/account.mjs`, `lib/routes/intake.mjs`, `myoConfig.business.radiusMiles` | ZIP eligibility endpoint and address in step 3 (CU1, CU3) |
| 5 | P1 | 2 | Recognition over recall; flexibility | Account required before any real quote; signed-out `#book` is a sign-in page | `assets/portal.js` `auth()`, `lib/routes/bookings.mjs` `/api/quote` (`access:'user'`) | Public quote endpoint; guest flow, account at step 3 (CU1, CU2) |
| 6 | P1 | 2 | Aesthetic and minimalist design; transparency | Default slot is inside the notice window, so the first total includes a $15 fee | `assets/portal.js` `updateQuote()` (`dayKeys[0]`, `firstTime`) | Server returns `notice_free_from`; default to the first fee-free day (CU7); label fee days (X-U4) |
| 7 | P1 | 2 | Visibility of system status | Full days (capacity 10) are offered and fail after selection; peak days aren't marked | `lib/scheduling.mjs` `bookableStarts()`, `lib/pricing.mjs` `checkLaunchCapacity()` | Availability returns per-day `full`, `peak`, `last_minute` flags (CU7); chips show them (X-U4) |
| 8 | P1 | 3 | Consistency; minimalism | Intake asked in 3 places with duplicated questions; care intake is one 2,700 px form with no progress | `assets/portal.js` `profileGroups`/`petForm()`, `assets/care-portal.js` `careSettings()`, `myo/launch/index.html` `#intake-form`, `lib/routes/intake.mjs` | One intake model split into 3 steps with per-step save (CU3); stepper UI (X-U5); remove the public form (X-U5) |
| 9 | P1 | 5 | Visibility of status; help users recognize next steps | No confirmation screen or next steps; no client email | `assets/portal.js` submit handler (`feedback.textContent = …`), `lib/routes/bookings.mjs` | `next_steps` contract and `request_received_client` message (CU8); confirmation view (X-U8) |
| 10 | P1 | 1 | Visibility; one primary CTA | No in-hero booking CTA; on mobile the header CTA is an unlabeled paw icon | `index.html` hero (`.hero-actions`), `assets/home.css` (`.header-actions .booking-label`) | Primary "Check availability" in hero, labeled on mobile (X-U1) |
| 11 | P1 | 1 | Transparency | No starting price or service area on the landing above the fold | `index.html`, `assets/home.js`, `assets/myo-copy.js` | "From $30 · within 15 miles of Springfield" line and ZIP check (X-U1, using CU1) |
| 12 | P1 | 2 | Layout stability | Sticky quote panel covers service and day chips on mobile when blockers show | `assets/portal.css` `[data-booking-summary]` | Bottom sheet with collapsed details on mobile (X-U3) |
| 13 | P1 | 2 | Match with real world | Price sheet says overnight has "No available times"; durations shown as "720 min" | `assets/price-sheet.js`, `bookingForm()` service labels | Overnight shows next available nights (CU7 data, X-U2 copy) |
| 14 | P1 | Return | Consistency | Returning client home leads with "Meet & Greet required for each new booking" | `assets/portal.js` `clientHome()`, `assets/care-copy.js` | Show the tile only when `meet_status` says it's needed (CU4 field, X-U9) |
| 15 | P1 | 5 | Error prevention | Meet & Greet bookable 50 minutes ahead; no minimum notice for an in-home meeting | `lib/routes/bookings.mjs`, `myoConfig.booking` | `meetNoticeHours` rule (CU7) |
| 16 | P2 | 3 | Tap targets | Help toggles 32×32 px; wordmark link 34–40 px tall | `assets/portal.css` (`.pet-field-tip summary`), `assets/home.css` (`.wordmark`) | Grow to 44×44 (X-U10) |
| 17 | P2 | Nav | Consistency | **Care details** listed twice in the portal menu and shown when signed out | `portal/index.html` (hard-coded link), `render()` links | Remove the hard-coded link (X-U9) |
| 18 | P2 | 1 | Match with real world | "How It Works" describes a 3-step flow that isn't the real one | `index.html` `#how` | Rewrite to the 5 real steps (X-U1) |
| 19 | P2 | 4 | Clarity | Review says "Sitter: Myomi"; "Visit total" on a Meet & Greet; times show "ET" while the page says "Massachusetts time" | `checkoutSummary()` | One wording for time zones; Meet & Greet-specific review copy (X-U7) |
| 20 | P2 | 2 | Minimalism | Up to 20 time chips per day on mobile (form about 2,000 px) | `updateQuote()` time groups | Collapse to Morning/Midday/Evening with the first 4 times each, "More times" (X-U3) |

**Not tested:** physical iPhone/Android, Safari, Firefox, screen readers, and a deployed site. All results above are from Chromium emulation against a local Node server.

<!-- claude-source-b89aa1f-end -->

</details>
