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
