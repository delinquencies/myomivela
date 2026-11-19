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
