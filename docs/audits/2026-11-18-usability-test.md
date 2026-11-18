# Usability and UX test — November 18, 2026

Customer and staff usability pass requested in [DEVELOPMENT_HANDOFF.md §7](../../DEVELOPMENT_HANDOFF.md#7-usability-and-ux-test-for-claude), run by Claude.

| | |
|---|---|
| **Commit** | `40bbca8` on `main` ("Refresh project notes and hand off the next usability test") |
| **Runtimes** | Node v22.23.4 (`server.mjs`, temporary SQLite) for every journey. The Cloudflare Worker runtime under `wrangler dev` 4.164.0 (Durable Object SQLite, local R2) for the empty-availability and overlay checks, which behaved identically. |
| **Browser** | Chromium (Playwright build), headless, emulated touch. No other browser engine was available. |
| **Viewports** | 390 × 844 touch (primary), 320 × 568 touch, 1280 × 800 desktop, 844 × 390 touch landscape |
| **Settings** | Time zone America/New_York, locale en-US; reduced-motion and 200 % root text size where noted |
| **Data** | Fictional only: staff account from the test settings; customers "Ana Fictional" (dog Cooper), "Ben Fictional" (Mochi), "Cara Fictional" (Pip). Each person had a separate browser context, so separate cookies and storage. |
| **Automated checks** | `npm test` 50 passed; `npm run test:worker` 42 passed, 8 Node-only skipped; `npm run test:browser` clean. axe-core 4.10.2 on 10 states. |

**All results are from emulation.** No physical iPhone or Android device, Safari/WebKit, Firefox, screen reader or real camera was available. See [Not tested](#not-tested).

> **Update, same day:** H1 (early start), H2 (hold expiry) and M1 (abandoned holds) are **fixed**; see [Fixes after this report](#fixes-after-this-report). The other findings are unchanged.

## Summary

The core loop works and is much smoother than in the [previous friction log](myo-live-ux-friction-log.md). A first-time customer can go from the homepage card to a sent request without dead ends. Staff can set hours, approve, publish a photo and complete a visit on a phone. The customer sees the update without a manual refresh, and another customer cannot open the photo. 11 of the 17 earlier friction items are fixed or mostly fixed; the other 6 are partly fixed or still open.

axe-core found **0 violations** in all 10 states checked (homepage in English and Spanish, signed-out portal, staff home, staff settings, booking form, booking review, publish form, customer diary, client home on desktop). No horizontal overflow appeared at 320 or 390 px. Every interactive element was at least 24 px. Reduced motion stopped all running animations.

The most important open problems:
1. **Staff can start a visit before its scheduled time.** This is retested; the timing rule still needs your decision.
2. **An expired hold isn't shown, and recovering from it loops.**
3. **The booking form puts its main button about 2,000 px down** on a phone.

## Findings, by severity

Each finding is marked **Bug** (behaviour that's wrong whatever the policy), **Policy** (needs an owner decision before it can be fixed), or **Design** (works, but costs the person effort).

### High

#### H1. Staff can start, update and complete a visit before its appointment time · Policy (retest of friction log #16)
- **Impact:** a tap on "Start visit" for the wrong visit, or a test tap, puts a live visit "In Progress". Its diary updates are then timestamped before the appointment.
  - The customer's diary showed an update at **7:23 AM** for a visit booked for **9:00 AM**.
  - After completion, the visit still appears under **Upcoming visits** with status "Completed", because its start time is in the future.
- **Steps:** a customer requests 9:00 AM today. At 7:23 AM, staff approve it, press **Start visit**, publish an update and complete the visit.
- **Expected:** "Start visit" is unavailable, or asks for confirmation, until an agreed time before the appointment.
- **Actual:** the server and UI accept it 97 minutes early.
- **Decision needed:** how early a visit may start. After that, enforce it in `lib/routes/bookings.mjs` and hide or explain the button in `bookingCard()` (`assets/portal.js`).
- **Screenshot:** [staff-published-390.png](2026-11-18-usability/staff-published-390.png)

#### H2. A hold that runs out isn't shown, and recovery loops back to the same lost time · Bug
- **Impact:** a customer who pauses on the review screen, which is common on a phone, is told nothing until they press Send. "Edit booking" then puts them back on the time that's already gone, so the next review fails too.
- **Steps (390 px):**
  1. Staff publish a window starting 3 minutes from now.
  2. The customer reviews that time and waits until the hold runs out at the start time (or after 10 minutes for later times).
  3. They press **Send booking request**, then **Edit booking**.
- **Expected:** when the hold runs out, the review says so (for example "Your hold ended — choose a time again") with a **Choose another time** action. The time list refreshes, so a time that's gone isn't offered.
- **Actual:**
  - After the hold ends, the screen still says "Time held until 7:29 AM ET" and Send stays enabled.
  - Sending shows "Your hold expired or the visit changed. Review the booking again." at the top. The review card stays, unchanged.
  - **Edit booking** restores the form with the **past 7:29 AM time still selected**, among 22 offered times that weren't reloaded.
- **Fix:**
  - On a 409 from `bookings`, reload `/api/portal` before reopening the form.
  - Start a timer from `expires` that changes the review into an expired state.
  - Both live in the booking submit branch and `checkoutSummary()` in `assets/portal.js`.
- **Screenshot:** [hold-expired-review-390.png](2026-11-18-usability/hold-expired-review-390.png)

#### H3. On a phone, "Review booking" is about 2,000 px below the top of the form · Design
- **Impact:** the form lists every available day for four weeks (23 tiles) and every start time for the chosen day (20 tiles) before the notes and the button. At 390 px the button starts at y ≈ 2,030, about 2.5 screens down. People who don't scroll that far may think nothing happens.
- **Steps:** with weekly hours Mon–Sat 8:00–18:00, open **Book a visit** at 390 × 844.
- **Expected:** the main action, or a summary of the choice with the action, stays reachable without long scrolling.
- **Actual:** the page is 2,146 px tall; see the screenshot.
- **Possible fixes:**
  - Show one week of days with "More dates".
  - Group times into Morning, Midday and Afternoon.
  - Or add a sticky bottom summary ("Wed Nov 18 · 9:00 AM · $30 — Review") once a time is chosen.
- **Screenshot:** [booking-form-full-390.png](2026-11-18-usability/booking-form-full-390.png)

### Medium

#### M1. Leaving a review without pressing Edit keeps the time from other customers for up to 10 minutes · Bug
- **Impact:** with one sitter, an abandoned review hides a real slot from everyone else. It's still offered to the same customer.
- **Steps:**
  1. Ana reviews a time.
  2. Ben (320 px) loads **Book a visit**, and isn't offered that time. That much is correct.
  3. Ana reloads the page; her review screen is gone.
  4. Ben reloads.
- **Expected:** the hold is released when the review is abandoned, or at least when Ana's page reloads without a review open.
- **Actual:** Ben still isn't offered the time. The hold lasts until its 10-minute expiry. Ana is offered it.
- **Fix:** release the hold on `pagehide` (`navigator.sendBeacon` to `/api/checkout-release`) and when the booking form renders without a review open.

#### M2. When no times are published, the booking form is a dead end · Design (friction log #9, still open)
- **Impact:** a new customer who completes intake before Myomi publishes hours sees "No times are available for this service right now. **Try another service** or check back later." That shows even when there's only one service. Notes and a disabled **Review booking** are still on screen.
- Times published by staff afterwards only appear after a **full page reload**. Switching sections doesn't pick them up. The same happens on the Worker runtime.
- **Expected:** a message under Service that doesn't suggest other services when there aren't any; a **Check again** button that reloads availability; unused fields collapsed.
- **Screenshot:** [no-times-390.png](2026-11-18-usability/no-times-390.png)

#### M3. A customer rescheduling a confirmed visit quietly un-confirms it · Policy
- **Impact:** the Reschedule panel on a **Confirmed** visit gives no warning. After choosing a new time the status goes back to **Waiting for Myomi**, and the only feedback is "Saved." The customer may believe the new time is confirmed.
- **Decision needed:** may customers move confirmed visits, and if so, does that need re-approval? In the meantime, warn in the panel ("Myomi will need to approve the new time") and use a specific confirmation message.

#### M4. At 200 % text size the homepage header and headline collide · Bug (accessibility, WCAG 1.4.4)
- **Steps:** at 390 px, set the root text size to 200 %. That's the equivalent of a large browser text setting.
- **Actual:**
  - The **Book a Visit** button covers the "myo." wordmark.
  - "second" in the headline is cut off at the right edge. The page clips rather than scrolling sideways, so this doesn't show up as horizontal overflow.
- **Expected:** the header wraps or shrinks the button label, and the headline wraps within the viewport.
- **Screenshot:** [home-text-200-390.png](2026-11-18-usability/home-text-200-390.png)

#### M5. Spanish ends at the portal · Policy (known)
Choosing **ES** on the homepage translates the public page completely; no English strings were left in the sample. **Reservar visita** then opens the portal in English, with `lang="en"`. The choice isn't carried across. This is already in the release work; I'm recording it from the customer's side.

### Low

| ID | Finding | Type | Details |
|---|---|---|---|
| L1 | The customer cancel dialog asks "Cancel or decline this booking?" | Design (friction #15, still open) | "Decline" is a staff action. Use "Cancel this visit?" for customers. Focus correctly lands on **Keep booking**. [cancel-dialog-320.png](2026-11-18-usability/cancel-dialog-320.png) |
| L2 | Several actions only say "Saved." | Design | Approve, decline, cancel and reschedule all end with "Saved.". "Request approved — Ana has been notified in the portal" or "Visit cancelled" would say what happened. |
| L3 | Staff home **Bookings** card opens a section titled **Today** | Design (friction #14, partly fixed) | The request count on the card is now right ("1 request to review"). Future requests sit under "Other upcoming bookings" in a section called "Today". |
| L4 | Staff publish button is below the first screen, and the notice covers the form | Design (friction #16, partly fixed) | At 390 px the activity grid is 330 px tall, and **Publish diary update** starts at y ≈ 959 in an 844 px viewport. The floating "Published…" notice then sits over the top of the activity choices until it's dismissed. Activity labels no longer break mid-word. |
| L5 | Reviewing in a second tab replaces the first tab's hold | Design | The first tab then says the hold "expired", which isn't what happened. Recovery works (Edit then review again). |
| L6 | Short landscape menus run off the screen | Design | At 844 × 390 the staff portal menu reaches y = 528. **Account**, **Back to website** and **Sign out** need the page scrolled to reach them. On the homepage the floating paw button overlaps the menu panel's corner but not its items. |
| L7 | Digits in the portal use whatever monospace font the device has | Design | `"Myo Tabular Digits"` maps to local Consolas, Menlo, Liberation Mono and similar fonts. Dates, prices and times read as code beside Outfit, and the look varies by device. Consider Outfit with `tabular-nums`, or a bundled digit subset. |

## What passed

- **Homepage:**
  - The hero copy is at full opacity on arrival (friction #1 fixed).
  - **Book a Visit** is a 48 px target in the first screen at 320, 390 and desktop.
  - Tapping **Dog Walking** scrolls 1,152 px to the card, and its **Book a walk** link is in view (friction #2 fixed).
  - The menu works with keyboard and Escape.
  - Spanish switches every visible string; axe finds 0 violations in English and Spanish.
- **Signed-out booking entry:**
  - The service is carried into the prompt.
  - **New here? Create an account** is at y = 166 and moves focus to the registration heading (friction #3 fixed).
  - Prices and the next available times show before sign-in.
  - "Myomi hasn't published rates yet" or "No available times in the next two weeks" show when there's nothing to book.
- **Registration:**
  - Empty and short-password submissions get specific browser messages.
  - Success says "Your account is ready." and continues to the next task (friction #4 fixed).
- **Pet intake:**
  - Only name and species are required; the other details are collapsed.
  - **Save & continue** is at y = 546.
  - Optional cards are labelled "(optional)" and offer **Skip for now** when blank.
  - An invalid phone gets an inline error with focus.
  - A reload mid-intake returns to step 4 with the answers kept.
  - Finishing returns to booking with "Pet added. You can continue booking." (friction #5–#8 fixed or mostly fixed).
- **Booking:**
  - A date closed by staff isn't offered.
  - **Review booking** without a pet shows "Choose at least one pet." under the pet choice and focuses it, with no server request (friction #10 fixed).
  - The review shows sitter, pet, time, duration, total, hold time and the payment state.
  - **Edit booking** keeps the time and notes.
  - No overflow at 320 px.
- **States are distinguishable:**
  - A held time: "Review your visit · Time held until…"
  - A request: "Waiting for Myomi"
  - A confirmed visit: "Confirmed" plus **View visit details**, which says "Your visit is confirmed. Online payment is currently unavailable." The old checkout-shaped screen is gone (friction #12 and #15 partly fixed).
- **Staff on a phone:**
  - Weekly hours, buffer, a closed date and two prices all saved, each with a confirmation visible on screen.
  - The 7-day calendar shows hours, "Closed" and visits.
  - Approving, starting, publishing with a photo from the library and completing all worked.
  - An unsent diary note and its chosen photo survived leaving the diary and coming back.
  - The camera input has `capture="environment"`.
- **Customer diary:**
  - It refreshes on entry, so the completed visit, summary and photo appeared without pressing Refresh (friction #17 fixed).
  - The filter offers pets and visits.
  - The photo has an accessible name and opens.
  - Another signed-in customer requesting the photo URL gets **404**.
- **Keyboard (desktop):**
  - Every Tab stop on client home had a visible focus indicator.
  - Swipe rails respond to arrow keys ("Day 2 of 7").
  - The portal menu opens with Enter and closes with Escape, returning focus to the toggle.
- **Layout:**
  - No horizontal overflow on five public routes at 320 px and desktop.
  - No overflow in staff settings, the booking form or the review at 320 and 390 px.
  - No fixed or sticky elements cover portal content.
  - In landscape the homepage header is 76 px tall once scrolled.

## Friction log retest

| # | Earlier finding | Now |
|---|---|---|
| 1 | Hero faint while animating | Fixed |
| 2 | Service pill looked like a dead tap | Fixed |
| 3 | Create account below the fold | Fixed |
| 4 | Registration errors far away; "Saved." | Fixed |
| 5 | No-pet booking gave no context | Fixed |
| 6 | Intake card 1 too long | Fixed |
| 7 | Optional cards sounded mandatory | Fixed |
| 8 | Final step wording | Mostly fixed (button says **Add pet**; return message is clear) |
| 9 | Empty availability dead end | **Open** (M2) |
| 10 | Review allowed with no pet | Fixed |
| 11 | Review layout and expiry guidance | Layout fixed; expiry guidance **open** (H2) |
| 12 | Request status and delivery | Status fixed ("Waiting for Myomi"); delivered confirmation waits on email/payment providers |
| 13 | Empty diary | Fixed in code ("Updates will appear here…" with **View my bookings**); not exercised in this run |
| 14 | Staff Bookings → Today | Partly fixed (L3) |
| 15 | Checkout-shaped confirmed view; dialog title | View fixed; dialog title **open** (L1) |
| 16 | Early start; Observation wrapping; button below fold | Early start **open** (H1); wrapping fixed; button still below fold (L4) |
| 17 | Diary needed manual refresh | Fixed |

## Not tested

- **Physical devices:** no iPhone or Android phone was available. One-handed reach, the software keyboard covering fields, rotation, real camera capture, the photo library picker and **HEIC** photos remain untested. Emulated touch at 390 and 320 px is not a substitute.
- **Other browsers:** only Chromium was available. Safari (macOS and iOS) and Firefox are untested.
- **Screen readers:** no VoiceOver, TalkBack or NVDA. Accessibility evidence is axe-core plus the keyboard checks above. Live-region announcements (for example the hold and status messages) were not heard.
- **Swipe versus vertical scroll:** synthetic touch drags in this environment didn't scroll the page even from plain content, so the test couldn't tell whether card rails trap vertical scrolling. The rails use `touch-action: auto`, so trapping isn't expected. Check on a real phone.
- **A real Cloudflare deployment, email and payment:** none exist yet.
- **Windows:** the Windows restore exit-code failures noted in the [sitewide audit](myo-sitewide-audit-and-next-steps.md) weren't reproducible here. On Linux the restore tests pass.

## Suggested order

1. Decide the early-start window (H1), then enforce it.
2. Fix hold expiry and its recovery (H2) and release abandoned holds (M1). These are confirmed bugs in the same part of `assets/portal.js`.
3. Shorten the booking form on phones (H3) and fix the empty-availability state (M2).
4. Fix the 200 % text collisions on the homepage (M4).
5. Tidy the wording items: M3 warning, L1–L3.
6. Run section 4 of the brief on real iPhone Safari and Android Chrome, especially camera, HEIC and the software keyboard.

## Fixes after this report

**H2 and M1, fixed in `assets/portal.js` and tested in `tests/browser/holds-smoke.mjs`** (part of `npm run test:browser`):
- **Hold ending:** while the review is open, a timer runs to the hold's end. When it fires, the review says **Hold ended** with an explanation, which is announced through a live region. **Send** is disabled, and the edit button becomes **Choose another time**.
- **Refused review or send:** **Choose another time**, or any refusal of the review or send (409: hold ended, replaced by another tab, time taken or price changed), reloads availability from the server. It reopens the form with current times and keeps the pet, service and notes. The reason appears at the top of the form, which receives focus.
- **Abandoned review:** closing, reloading or leaving the page with a review open releases the hold with a `keepalive` request. Returning through the back/forward cache marks the review as ended. A redraw that discards an open review, such as saving a pet in another section, also releases its hold. Switching apps keeps the hold, on purpose.
- **Verification:** 15 browser checks across 4 scenarios, on Node (twice) and on the Worker runtime. Against the previous `assets/portal.js`, each of the 4 scenarios fails, 7 checks in all.
  - The expiry scenario fast-forwards the browser clock past the hold.
  - A real server-side expiry is covered by the same 409 path, exercised through the two-tab case.
- **Not covered:** the back/forward-cache path, which headless Chromium doesn't exercise, and real phones.

**H1, fixed with the owner's rule: a visit can start from the visit buffer (default 30 minutes) before its booked time.**
- **Server:** `POST /api/status` refuses an earlier start with "This visit can start from 8:30 AM ET (30 minutes before it is booked)." Starting late is still allowed. The limit follows the **Buffer before and after a visit** setting, whose help text now says so.
- **Override:** `MYO_EARLY_START_MINUTES` can override the limit. The test helper sets it so suites can start visits booked days ahead.
- **Staff portal:** until the visit can start, **Start visit** is disabled with "You can start this visit from …". A 15-second check enables it when the time comes.
- **Verification:**
  - `tests/early-start.test.mjs` runs on both runtimes and fails against the previous `lib/routes/bookings.mjs`. It covers 3 hours early refused, 10 minutes early allowed, a buffer of 0 refusing a 12-minute-early start, and a buffer of 15 allowing it.
  - The browser test (`holds-smoke.mjs`, scenario 5) checks the disabled button and its note, the button enabling itself when the page clock reaches the time, and the server still refusing because its clock hasn't moved.
