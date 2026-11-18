# Codex track

November 18, 2026 · Based on [the competitive audit](../competitive-audit.md) · Pairs with [the Claude track](claude-plan.md)

Tickets are self-contained. A ticket marked **Independent** can start now. A ticket marked **Blocked on C…** starts once that Claude task has landed and published its contract; the contract is quoted in `claude-plan.md` under that task.

## Conventions for every ticket
- **Portal UI** lives in `assets/portal.js`: string-built HTML through the helpers `form()`, `input()`, `area()`, `button()`, `choice()`, `choiceGroup()`, `tapLink()` and `section()`.
  - Escape every value with `text()` (`escapeHtml`).
  - Styles go in `assets/portal.css`.
  - No frameworks and no new runtime dependencies.
- **Keep `assets/drafts.js` working.** Forms need a stable `data-action` and `data-id`. Password and secret fields must be `type="password"` or carry `autocomplete="off"`, and secret fields must also be excluded from drafts (see X2.3).
- **Writes go through `api(path, payload, key)`** with a key from `requestKey(form, …)` (safe retries). Show errors with `showPublicationFeedback()` or an inline `role="alert"` element next to the control.
- **Browser tests:**
  - Copy the structure of `tests/browser/holds-smoke.mjs`: `loadPlaywright()`, `startServer()` from `tests/helpers.mjs`, `check()`, console-error watching, and a 390×844 touch context in `America/New_York`.
  - Add each new script to the `test:browser` chain in `package.json`.
  - Every script must pass on Node and with `MYO_TARGET=worker`. Use fictional data only.
- **Static pages** use `data-es`, `data-es-label` and `data-es-alt` for Spanish (see `assets/home.js` `setLanguage()`).
- **Definition of done:** `npm test`, `npm run test:worker` and `npm run test:browser` all pass; no new axe violations (X1.5); no horizontal overflow at 320 px.

## Dependency map
| Ticket | Phase | Prerequisite |
|---|---|---|
| X1.1 Compact booking form | 1 | Independent |
| X1.2 "No times" state with Check again | 1 | Independent |
| X1.3 Role-specific copy and feedback | 1 | Independent |
| X1.4 Homepage at 200% text | 1 | Independent |
| X1.5 Accessibility and layout regression suite | 1 | Independent |
| X1.6 Itemised quote and extra-pet price UI | 1 | Blocked on C1.1 |
| X1.7 Change-request UI | 1 | Blocked on C1.2 |
| X1.8 Departure check UI | 1 | Blocked on C1.3 |
| X1.9 Meet & greet UI and copy | 1 | Blocked on C1.4 |
| X2.1 Vaccine records and blocked-booking UI | 2 | Blocked on C2.2 |
| X2.2 Agreement step | 2 | Blocked on C2.2 |
| X2.3 Home-access forms and staff reveal | 2 | Blocked on C2.3 |
| X2.4 Report-card fields | 2 | Blocked on C2.4 |
| X2.5 Pet timeline view | 2 | Blocked on C2.5 |
| X2.6 Spanish portal | 2 | Blocked on C2.6 |
| X2.7 "Book again" and Happiness Score | 2 | "Book again": Independent · Score: blocked on C2.5 |
| X2.8 Overnight booking UI and stay diary | 2 | Blocked on C2.1 |
| X2.9 Staff customer list and notes | 2 | Blocked on C2.7 |
| X3.1–X3.6 | 3 | Blocked on C3.1–C3.6 respectively |

---

## Phase 1

### X1.1: Compact booking form on phones · Phase 1 · Independent
**Problem:** at 390 px, "Review booking" sits about 2,000 px down the form (usability report H3; `docs/audits/2026-11-18-usability/booking-form-full-390.png`).

**Files:** `assets/portal.js` (`bookingForm()`, `updateQuote()`, the `change` listener), `assets/portal.css`.

**Spec**
- **Days:** show 7 at a time with **Earlier** and **Later dates** buttons (`type="button"`, `data-day-page="-1"` / `"1"`). Each button is disabled at its end of the range. Choosing a day on another page keeps working.
- **Times:** group them under three `<fieldset>` headings, Morning (before 12:00), Midday (12:00–15:59) and Evening (16:00 onward) in Eastern time. Omit empty groups.
- **Summary bar:** once a time is chosen, a sticky bar at the bottom of the form (`[data-booking-summary]`, `position: sticky; bottom: 0`) shows "Wed, Nov 18 · 9:00 AM · $30.00" and a full-width **Review booking** button. It replaces the existing submit button, keeping `type="submit"` and the same label.
- **Drafts:** a restored day on page 2 must open on page 2.

**Acceptance and end-to-end assertions** (new `tests/browser/booking-form-smoke.mjs`)
- At 390×844 with hours every day from 08:00 to 18:00, the form's first screen contains at most 7 day tiles.
- After choosing a time, the **Review booking** button's bounding box is entirely within the viewport without scrolling.
- The summary bar text matches the chosen day, time and price.
- **Later dates** reveals days 8–14; choose a day there, save something in another section (to force a redraw), return, and the same day and time are still selected.
- The axe check from X1.5 reports no violations on this form; no horizontal overflow at 320×568.

### X1.2: "No times" state with Check again · Phase 1 · Independent
**Files:** `assets/portal.js` (`updateQuote()`, `bookingForm()`), `assets/portal.css`.

**Spec**
- **When the chosen service has no times:** show `[data-availability]` directly under the Service group. With one service: "Myomi hasn't published times for {service} yet." With several: the current wording.
- **Hide** the day, time, notes and quote while there are no times.
- **Check again:** a `type="button"` button `[data-check-availability]` refetches `/api/portal`, merges `slots` into `data.slots`, and re-runs `updateQuote()` without a full re-render. While loading it's disabled with "Checking…". If still empty, it announces "Still no times — try again later." through `role="status"`.

**Acceptance and end-to-end assertions** (add to `booking-form-smoke.mjs`)
- With one service and no hours, the message names that service and doesn't say "try another service"; the notes field isn't visible.
- Publish hours through the staff API, press **Check again** without reloading: times appear and the notes field is visible.
- Press **Check again** with still no hours: the status text reads "Still no times — try again later."

### X1.3: Role-specific copy and feedback · Phase 1 · Independent
**Files:** `portal/index.html` (`#cancel-booking` dialog), `assets/portal.js` (`confirmCancellation()`, the submit success messages, `staffHome()`, `publishingDesk()`).

**Spec**
- **Cancel dialog:**
  - Customer: title "Cancel this visit?", buttons "Keep visit" and "Cancel visit".
  - Staff on a Requested booking: "Decline this request?", buttons "Keep request" and "Decline request".
  - Staff on a Confirmed booking: "Cancel this visit?".
  - `confirmCancellation(kind)` sets the title and button text before `showModal()`.
- **Success messages:**
  - Approve → "Request approved."
  - Decline → "Request declined."
  - Cancel → "Visit cancelled."
  - Reschedule → "Visit moved to {day, time}." (customer, Requested booking) or "New time saved." (staff)
  - Start → keep as is.
- **Staff home:** the card `['upcoming','Bookings', …]` becomes `['upcoming','Today & upcoming', …]`, and the section heading becomes "Today & upcoming".
- **Publish form:** in `eventForm()`, move **Publish diary update** directly under the notes field, before the photo choices. Add `scroll-margin-top` so the floating notice never covers the activity choices (`.portal-feedback.is-notice` in `assets/portal.css`).

**Acceptance and end-to-end assertions** (extend `tests/browser/portal-smoke.mjs`)
- The customer's cancel dialog `h3` reads "Cancel this visit?", with no "decline"; staff declining a request sees "Decline this request?".
- After staff approve, `#feedback` reads exactly "Request approved."
- On the staff home, the first card's label is "Today & upcoming", and following it focuses an `h2` with the same text.
- At 390×844, with a visit In Progress, the **Publish diary update** button's top is at most 844 after filling the notes.

### X1.4: Homepage at 200% text · Phase 1 · Independent
**Files:** `assets/home.css` (header, `.header-booking`, `.hero-copy h1`).

**Spec**
- At a root font size of 200%, the header wraps: the booking button may drop its text label and keep the paw icon with `aria-label="Book a Visit"`.
- The hero heading uses `overflow-wrap: anywhere` and clamps its size so no word is clipped.
- Nothing changes at 100%.

**Acceptance and end-to-end assertions** (new `tests/browser/a11y-smoke.mjs` from X1.5)
- At 390×844 with `document.documentElement.style.fontSize='200%'`:
  - the bounding boxes of `.wordmark` and `.header-booking` don't intersect;
  - every word span of `.hero-copy h1` has `getBoundingClientRect().right <= innerWidth`;
  - `scrollWidth <= clientWidth`.
- At 100%, a screenshot comparison of the header region is unchanged; use `toHaveScreenshot` with a stored baseline, or compare bounding boxes against recorded values.

### X1.5: Accessibility and layout regression suite · Phase 1 · Independent
**Files:** new `tests/browser/a11y-smoke.mjs`; `package.json` (add `axe-core` pinned to `4.10.2` as a devDependency; add the script to `test:browser`).

**Spec**
- Load axe through `page.evaluate(readFileSync(require.resolve('axe-core/axe.min.js')))`. Injecting a `<script>` is blocked by the site's CSP, and that must stay true.
- Run axe at 390×844 on:
  - signed out: the homepage (English and Spanish), About, FAQ, the sample diary and the portal;
  - customer: home, the booking form, the review, My bookings, Pet Diary and Account;
  - staff: home, Today, Publish (with a visit In Progress) and Settings.
- On the same screens, check for horizontal overflow at 320×568 and 390×844, and for interactive targets smaller than 24×24 px.
- Fail on any axe violation of `serious` or `critical` impact, any overflow, or any undersized target. Print the rule ids and selectors.

**Acceptance and end-to-end assertions**
- The suite passes on today's `main` (the baseline usability pass found 0 violations).
- Deliberately removing an `aria-label` from `.menu-toggle` makes it fail.

### X1.6: Itemised quote and extra-pet price UI · Phase 1 · Blocked on C1.1
**Files:** `assets/portal.js` (`updateQuote()`, `checkoutSummary()`, `bookingCard()`, `adminSettings()`), `assets/portal.css`.

**Spec**
- **Quote:** when the service, pets or time changes, call `POST /api/quote`, debounced by 250 ms and with stale responses ignored. Replace the `[data-quote]` text with a `<dl class="quote-lines">` of `lines`, then "Total {money(total_cents)}".
- **Submit amount:** send `cents: total_cents`, not `service.cents`.
- **Review and cards:** `checkoutSummary()` and customer `bookingCard()` render `lines` the same way.
- **Staff settings:** the **Set a service price** form gains "Extra pet (USD)" (`name="extra_pet"`, number, min 0, step 0.01), sent as `extra_pet_cents`. The services list shows "+ $X per extra pet" when it's not zero.
- **Error codes:** `price_changed` → re-quote, then show "The price changed — review the new total." next to the total.

**Acceptance and end-to-end assertions** (new `tests/browser/pricing-smoke.mjs`)
- With staff setting Dog walking at $30 + $10 per extra pet and a customer with 2 pets: one pet shows Total $30.00; two pets show the lines "Dog walking $30.00" and "Extra pet × 1 $10.00", Total $40.00.
- The review shows the same lines.
- After sending, the booking card in My bookings shows Total $40.00.
- When staff change the extra-pet price while the customer is on the form, sending shows the price-changed message and the new total.

### X1.7: Change-request UI · Phase 1 · Blocked on C1.2
**Files:** `assets/portal.js` (`bookingCard()`, the reschedule `<details>`, `staffHome()`, the submit handler), `assets/portal.css`.

**Spec**
- **Customer, Confirmed visit:** the reschedule panel states "Myomi will confirm the new time. Your current time stays booked until then." After sending: "Change requested — waiting for Myomi.", and the card shows "Requested change: {day, time}" with **Withdraw request** (`POST /api/changes/withdraw`).
- **Staff:** cards with `pending_change` show "Customer asked to move to {day, time}", with **Approve change** and **Decline change** (`POST /api/changes/decide`). The staff home card count includes pending changes: "{n} to review".
- **Error codes:** `time_reserved` → "That time was taken. Decline the change or ask for another time."

**Acceptance and end-to-end assertions** (new `tests/browser/changes-smoke.mjs`)
- After a customer requests a change on a Confirmed visit, the card still says "Confirmed" at the original time and shows the requested change.
- Staff approve → the customer card (after reload) shows the new time, Confirmed, and no pending change.
- Withdraw → the requested-change line disappears.
- Staff decline → the original time remains; the customer sees "Change declined" once.

### X1.8: Departure check UI · Phase 1 · Blocked on C1.3
**Files:** `assets/portal.js` (`statusForm()` for Completed), `assets/diary.js` (`renderDiaryVisits()`), `assets/portal.css`.

**Spec**
- **Completion form fields:**
  - a checkbox `name="secured" value="1"` labelled "Doors locked and home secured";
  - a textarea `name="secure_note"`, hidden unless the checkbox is unticked after first interaction, labelled "What wasn't secured, and what did you do?".
- **Submitting:** **Complete visit** stays disabled until the box is ticked or the note has 3 or more characters. The payload sends `secured:true|false`.
- **Diary:** shows "🔒 Home secured at {time}" or "⚠️ Not fully secured: {note}" under the visit summary.

**Acceptance and end-to-end assertions** (extend `portal-smoke.mjs`)
- **Complete visit** is disabled with only a summary filled in, and enabled after ticking the box.
- The customer diary shows "Home secured at" for that visit.
- Completing with the box unticked and the note "Back gate latch broken" shows the warning line with that note.

### X1.9: Meet & greet UI and copy · Phase 1 · Blocked on C1.4
**Files:** `assets/portal.js` (`bookingForm()`, `clientHome()`, `bookingCard()`, `serviceIcons`, `serviceNames` map), `index.html` ("How It Works" step 02), `myo/about/index.html`, `assets/home.js` (only if price tags need a "Free" label).

**Spec**
- **Booking:** the "Meet & Greet" service shows icon 🤝 and price "Free". When `first_visit` is true, `clientHome()` shows the card **Book a free Meet & Greet** first ("Meet Myomi before your first visit"), linking to `#book?service=meet`.
  - Add `['meet','Meet & Greet']` to the `serviceNames` map, so `?service=meet` preselects it.
- **Review and cards:** for `total_cents === 0` the review shows "No charge" and hides the payment note. Booking cards show "Free".
- **Homepage step 02:** links "meet me" to `portal/index.html?service=meet#book`, with the Spanish `data-es` updated to match.

**Acceptance and end-to-end assertions** (new `tests/browser/meet-smoke.mjs`)
- A new customer's home shows **Book a free Meet & Greet** first; after a Completed visit it no longer does.
- Booking a meet & greet: the review says "No charge"; staff approve, start and complete it.
- The homepage link in step 02 opens the booking form with Meet & Greet preselected (in both English and Spanish).

---

## Phase 2

### X2.1: Vaccine records and blocked-booking UI · Phase 2 · Blocked on C2.2
**Files:** `assets/portal.js` (`petForm()` gains a "Vaccinations" card, replacing the free-text `vaccinations` field; `profileSummary()`; `bookingForm()`; the submit handler for the 409 `blocked` error), `assets/portal.css`.

**Spec**
- **Vaccine rows:** for each required name in `requirements[species]`, a row with Given (`type=date`, optional), Expires (`type=date`, required) and **Upload record** (file input, `accept="application/pdf,image/*"`, at most 5 MB, checked on the client).
- **Badges:** `ok` ✓ green, `due_soon` orange "Due {date}", `expired` red "Expired {date}", `missing` red "Missing". "Verified by Myomi" shows when `verified`.
- **Booking:** after choosing pets and a time, call `GET /api/blockers`. If there are blockers, disable **Review booking** and list each `message` with a link to `#pets` (for vaccines) or the agreement (X2.2). The same list renders from a 409 `blocked` response.
- **Staff:** booking cards show the badges per pet, with **Mark verified** (`POST /api/vaccines/verify`).

**Acceptance and end-to-end assertions** (new `tests/browser/compliance-smoke.mjs`)
- A dog with Rabies expired yesterday: the booking shows "Rabies expired" and **Review booking** is disabled.
- After updating the expiry to next year, the blocker disappears without a reload and review succeeds.
- A Rabies expiry falling inside a 3-night stay (with X2.8) shows the "expires during" message.
- Uploading a 6 MB file is refused on the client; a 100 KB PDF uploads and staff can open it.

### X2.2: Agreement step · Phase 2 · Blocked on C2.2
**Files:** `assets/portal.js` (a new `agreementPanel()` used in `clientHome()` and as a blocker target), `assets/portal.css`.

**Spec**
- **Panel contents:** the title, the body in the current language (`body_es` when `locale()==='es'`), a checkbox "I have read and agree" and **Accept**, which posts `/api/agreement/accept { version }`.
- **When it shows:** whenever `accepted` is false, at the top of client home and from an `agreement_required` blocker link.
- **After accepting:** "Agreement accepted on {date}" appears in Account.

**Acceptance and end-to-end assertions** (in `compliance-smoke.mjs`)
- A new customer is blocked with "agreement_required" until accepting; after accepting, review succeeds.
- When staff publish version 2 (through the test API), the customer is blocked again on the next booking.
- In Spanish mode the Spanish body text is shown.

### X2.3: Home-access forms and staff reveal · Phase 2 · Blocked on C2.3
**Files:** `assets/portal.js` (a new Account section "Home access"; staff `bookingCard()`; `publishingDesk()`), `assets/drafts.js` (skip fields with `data-no-draft`), `assets/portal.css`.

**Spec**
- **Customer form:**
  - **Method** as radios (Key, Lockbox, Door code, Doorman, Other).
  - **Instructions** as a textarea (at most 1,000 characters, `autocomplete="off"`, `data-no-draft`).
  - **Key label**, optional.
  - The current key status shows as "Myomi has your key", "Key with you" or "Key returned".
- **Staff, Confirmed visit:** the card shows the method and key status, plus "Entry details unlock at {available_from}" until the reveal window.
- **Staff, In Progress visit:** the card has **Show entry details**. Pressing it fetches `/api/home-access/booking/:id` and shows the instructions in a `<details>` that collapses again after 60 seconds or on leaving the section.
- **Keys:** staff can set the key status with three radios. Client home for staff lists `keys_to_return`.
- **Drafts:** `assets/drafts.js` must skip any field with `data-no-draft` in both `capture()` and `restore()`.

**Acceptance and end-to-end assertions** (new `tests/browser/home-access-smoke.mjs`)
- The customer saves "Lockbox 4821 behind the planter". Before the visit window the staff card shows no "4821" anywhere in the DOM; after Start, **Show entry details** reveals it.
- No `sessionStorage` key `myo-drafts:*` contains "4821" at any point.
- The backup download (`/api/backup`) does not contain the string "4821".
- Setting the key to "with_myomi" with no upcoming visits lists the customer under "Keys to return".

### X2.4: Report-card fields · Phase 2 · Blocked on C2.4
**Files:** `assets/portal.js` (`eventForm()`, the submit handler for `events`), `assets/diary.js` (`renderDiaryVisits()` with `fieldsFor`), `assets/portal.css`.

**Spec**
- **Publish form:** after an activity is chosen, render the template's fields for the booking's service kind and that activity.
  - `yesno`: two tap choices, Yes and No.
  - `count`: a number input with steppers.
  - `choice`: radios.
- **Payload:** `data:{ [id]: value }`.
- **Diary:** render `fields` as chips (✓ Pee, ✓ Water, 25 min) under the notes. Staff see hidden values greyed out with "(hidden from client)".

**Acceptance and end-to-end assertions** (new `tests/browser/report-card-smoke.mjs`)
- Publishing "Walk completed" with Pee Yes, Poop No and 25 minutes: the customer diary shows "Pee" and "25 min" and not "Poop".
- The staff view shows "Poop: No (hidden from client)".
- An older event without `data` still renders.

### X2.5: Pet timeline view · Phase 2 · Blocked on C2.5
**Files:** `assets/portal.js` (on each pet card in `#pets`, a **Care history** link to `#pet-{id}`, plus a new section renderer), `assets/diary.js` (reuse the entry renderer), `assets/portal.css`.

**Spec**
- **Content:** a vertical, month-grouped timeline of `entries`: visit (service, date, summary), event (icon, kind, fields, photo thumbnail), vaccine (name and status), profile change ("Updated: medication, feeding").
- **Paging:** **Show older** follows `next`.
- **Staff:** reach it from the customer page (X2.9) and from booking cards.

**Acceptance and end-to-end assertions** (new `tests/browser/timeline-smoke.mjs`)
- After two completed visits and a profile edit, the timeline shows both visits newest first and a "profile change" entry listing the changed fields.
- A second customer opening `#pet-{id}` for the first customer's pet sees no entries; the API returns 404.

### X2.6: Spanish portal · Phase 2 · Blocked on C2.6
**Files:** `assets/i18n.js` (fill the `es` catalog), `assets/portal.js` (replace literals with `t()`), `portal/index.html` (static strings through `data-es`, as on the public site), `myo/client_journal_cute_lively/index.html` and `assets/diary-sample.js` (Spanish sample).

**Spec**
- **Coverage:** every user-visible portal string comes from `t()`: navigation, sections, forms, validation, statuses ("Waiting for Myomi" → "Esperando a Myomi"), dialogs, the price sheet and errors (`t('error.'+code)`).
- **Language switch:** a toggle (EN / ES) in the portal menu sets `localStorage['myo-language']` and `POST /api/locale`.
- **Formatting:** dates and money use `formatDate` and `formatMoney` (`es-US`).

**Acceptance and end-to-end assertions** (new `tests/browser/spanish-smoke.mjs`)
- After choosing ES on the homepage, **Reservar visita** opens the portal in Spanish (`lang="es"`).
- Run register → pet intake → book → review → send: collect every visible text node and assert none matches the English catalog values. Keep an allow-list for proper names, prices and the brand.
- The Spanish sample diary renders.
- No horizontal overflow at 320 px in Spanish.

### X2.7: "Book again" and Happiness Score · Phase 2 · "Book again": Independent · Score: Blocked on C2.5
**Files:** `assets/portal.js` (`bookingCard()` for past visits, `bookingForm()` accepting a prefill, `renderDiaryVisits()` caller), `assets/diary.js`.

**Spec**
- **Book again** (independent): on past Completed visits, links to `#book` with sessionStorage key `myo-prefill` = `{ service, pets }`. `bookingForm()` consumes it once to preselect the service and pets.
- **Happiness Score** (after C2.5): on Completed visits in the diary, show "How was this visit?" with three buttons (🙂 Great, 😐 Okay, 🙁 Not great). After choosing, show an optional comment box and "Thanks — only Myomi sees this."
- **Staff:** Financials shows the 30-day counts from `GET /api/feedback`.

**Acceptance and end-to-end assertions** (new `tests/browser/retention-smoke.mjs`)
- **Book again** opens the form with the same service and pet checked.
- Choosing 🙁 with the comment "Late arrival" shows the thanks text; staff Financials shows Not great: 1 and the comment.
- A second customer can't post feedback for that visit: the API returns 404.

### X2.8: Overnight booking UI and stay diary · Phase 2 · Blocked on C2.1
**Files:** `assets/portal.js` (`bookingForm()` branches on `service.kind==='overnight'`; `adminSettings()` adds overnight nights and late-pickup grace; `weekCalendar()` shows stays across days), `assets/diary.js` (group by `nights`), `assets/portal.css`.

**Spec**
- **Booking:** the overnight form shows a two-month calendar of `overnight_nights` (tap the arrival date, then the departure date), plus drop-off and pickup times (30-minute steps). The quote shows "{n} nights × $X".
- **Diary:** the stay renders one header with a "Night 1 · Thu, Nov 19" sub-heading per night; check-in kinds have their own icons.
- **Staff settings:** "Overnight nights" day checkboxes and "Late pickup grace (minutes)".

**Acceptance and end-to-end assertions** (new `tests/browser/overnight-smoke.mjs`)
- Booking Thu–Sun shows 3 nights with the right total. A closed date inside the range can't be chosen and shows "Myomi is unavailable on {date}".
- After staff publish an "Evening check-in" on night 2, the customer diary shows it under the Night 2 heading.
- Completing the stay 3 hours after the planned pickup adds a "Late pickup" line to the booking.

### X2.9: Staff customer list and notes · Phase 2 · Blocked on C2.7
**Files:** `assets/portal.js` (a new staff section `#clients` with a portal menu link "Clients", `clientDetail()`), `assets/portal.css`.

**Spec**
- **List:** search by name or email (debounced, 300 ms), a paged list (name, pets, upcoming count, last visit).
- **Detail:** contact, pets with full profiles and badges, bookings, and private notes. Add or edit a note with a textarea; it's labelled "Private — clients never see this".

**Acceptance and end-to-end assertions** (new `tests/browser/clients-smoke.mjs`)
- Staff search "Ana" → open the customer → add the note "Prefers texts" → it's shown after reload.
- Signed in as that customer, no page or API response contains "Prefers texts". Scan the `/api/portal`, `/api/diary` and `/api/pets/:id/timeline` JSON.

---

## Phase 3 (each blocked on its Claude task and the related owner decision)

| Ticket | Prerequisite | Scope | Key end-to-end assertions |
|---|---|---|---|
| X3.1 Payment and tip UI | C3.1 | Payment status chips on cards; **Pay now** / redirect handling; a tip form (one-time) and Auto Tip in Account; staff ledger view per booking | Paid status appears only after the webhook fixture fires, never from the redirect alone; a refund shows a negative line and an updated balance; an auto-tip of 15% adds a tip line on completion |
| X3.2 Cancellation fee preview | C3.2 | The cancel dialog shows "Cancelling now costs $X (after {cutoff})" from `/api/cancellation-preview` | Before the cutoff: no fee; after: the fee shown matches the ledger line; staff cancellation shows no fee |
| X3.3 Recurring series UI | C3.3 | Create a series (weekdays, time, pets, until); a projections list with **Skip this date**; conflict badges | Creating Mon/Wed/Fri shows 4 weeks of projections; skipping one removes only that date; a closed date shows "Conflict" |
| X3.4 Fee rules settings | C3.4 | Staff form for weekend, holiday, after-hours and short-notice rules; the holiday list | A holiday booking shows the itemised surcharge in the quote and review |
| X3.5 Packages UI | C3.5 | Buy a package, show the balance, choose "Use package credit" at review | Using a credit sets the review total to $0 with a credit line; cancelling restores the balance |
| X3.6 Notification settings and templates | C3.6 | Email templates (EN and ES) and preferences in Account | Approving a request queues exactly one "approved" message in the outbox fixture, in the customer's language |
