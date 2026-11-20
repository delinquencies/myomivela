# MYO — Application Flow & Information Architecture Audit

**Date:** November 20, 2026 · **Code:** `audit-remediation` at `28e3ad5` (same as `main`) · **Scope:** the signed-in portal (`portal/index.html`, `assets/portal.js`, `assets/care-portal.js`, `assets/portal-route-state.js`, `assets/booking-journey-ui.js`). Public pages are out of scope except where they hand off to the portal. This is the first file with this name; no earlier findings to preserve. No application code or other documentation was changed.

**How the evidence was gathered**

- **Code reading** of the route registry, `render()`, `showSection()`, the dashboards, booking card, visit tools, settings and the client record.
- **One throwaway browser walkthrough** (Playwright, 390×844 phone viewport, temporary database, catalog pricing as in the test suite). It signed in as the owner and as a new client, opened each menu destination, and recorded the menu items, the visible section, its height and its form count. Items marked **(observed)** below come from that run.
- **Not executed:** a full booking with a pet, a live visit, or a published report. Creating a pet through the raw API in my script did not produce a pet, so booking-with-pet friction comes from code, not observation. Those flows are covered functionally by the existing browser suite (`tests/browser/*-smoke.mjs`, last full run passing on Nov 19), which proves they *work*, not that they are *easy*.

Labels used: **Verified** = seen in code with an exact path or observed in the walkthrough. **Assumption** = inferred, not confirmed. **Missing** = a feature the target model describes that doesn't exist; that is not a navigation defect.

---

## 1. Executive conclusion

**Reorganize; don't rebuild.** The crowding comes from navigation and screen grouping, not from the underlying systems:

- The portal is one page that renders **every** section at once (`assets/portal.js:941-955`) and shows one at a time (`showSection()`, `portal.js:1009-1080`). Moving, merging or nesting destinations is a change to the route list and `render()`, not to data or APIs.
- The route registry (`assets/portal-route-state.js:20-51`) already has parent/child routes, per-role menus and old-link redirects. It just lists too many top-level items.
- Logic built for the simpler model already exists but **isn't used by the portal**: `customerSummary()`, `staffWorkQueue()` and `nextSteps()` in `assets/visit-state.js`. Only the server imports that module (`lib/routes/bookings.mjs:21`). They compute exactly what the target "Today" and "Home" screens need.
- Codex's plan already has the right item open: DUX-07 (`docs/plans/codex-ux-plan.md:98-106`, unchecked). This audit supplies the evidence and the order.

**Top three sources of friction**

1. **One visit is split across two destinations.** Myomi starts and completes a visit under "Today & upcoming" but logs care under a separate "Publish updates" page, with links bouncing between them (`portal.js:543`, `portal.js:462`). The care intake (feeding, meds, vet, emergency contact) isn't on the visit at all; it's only in Clients → search → record (`care-portal.js:646-670`).
2. **Menus list features, not goals.** Admin: 7 menu items plus Account, and "Staff home" sits third because menus follow registry order **(observed)**. Customer: 6 items plus Account **(observed)**. Both home screens repeat the menu as tiles (`portal.js:845-870`).
3. **Settings is one 4,770-pixel page at phone width** with 7 forms: hours, date changes, prices, extra windows, backup, staff, booking requirements **(observed)**. The sub-routes `#settings/hours|services|policies|team|backups` all show that same full page (`portal.js:1024`, observed: same height).

---

## 2. Current navigation inventory

### Admin (owner; a sitter sees the same without Settings and Financials)

| Menu item (observed order) | Route id (`portal-route-state.js`) | What it shows (`portal.js`) |
|---|---|---|
| Today & upcoming | `upcoming` (27) | Today's/active bookings, then "Other upcoming bookings" (942) |
| Publish updates | `diary` (38) | Care-logging form per active visit, then published feed (455-464, 949) |
| Staff home | `staff-home` (42) | 6 tiles repeating the menu, a 7-day calendar, keys to return (856-870) |
| Booking history | `history` (43) | Past booking cards (952) |
| Clients | `clients` (44), `client/:id` (45) | Search, then a record with pets, intake, booking and care history, notes (`care-portal.js:489-500`, 640-700) |
| Services & availability | `settings` (46), `settings/*` (47) | All 7 settings forms on one page (721-760, 945) |
| Financials | `financials` (48) | Totals by service (885-910) |
| Account (separate link) | `account` (50) | Password, sign out everywhere, staff items (761-780) |
| — no menu entry | `visit/:id` (40) | One booking card, built when opened (1027-1040) |

### Customer

| Menu item (observed) | Route id | What it shows |
|---|---|---|
| Home | `client-home` (26) | Meet & Greet invitation, 5 tiles repeating the menu, 7-day calendar (845-855) |
| My bookings | `upcoming` (27) | Upcoming then past cards, with cancel/reschedule/pay on each (942-944) |
| Book a visit | `book` (28), `book/*` (30-33) | Booking form, review and hold (366-401, 947) |
| My pets | `pets` (34), `pets/new` (35), `pet/:id` (36) | Pet cards with profile, vaccines, "Care history" link and inline edit (946); per-pet care history (`care-portal.js:473-488`) |
| Care details | `care` (37) | Agreement, 11-item household intake, home access, 1,425 px tall (observed) (`care-portal.js:184-188`) |
| Pet Diary | `diary` (38) | All published updates, with a filter by pet or by visit (665-694) |
| Account (separate link) | `account` (50) | **Automatic tip first**, packages, change password, sign out everywhere (observed, 761-780) |
| — no menu entry | `visit/:id`, `checkout-:id` | Visit details and review (948, 1023) |

### Screens reachable from several places (Verified)

- **Booking cards** appear on Today & upcoming, Booking history, visit details and the client record, each with its own set of actions.
- **Per-pet history exists twice for customers:** Pet Diary filtered by pet (`portal.js:685`), and "Care history" on each pet (`care-portal.js:473`).
- **Pet care information exists in three places for customers:** pet profile fields (`portal.js:255` `petForm`), the household intake in Care details, and vaccine records inside each pet card. The intake prefills from the profile (`intake-model.js:20-21`), which is how the duplication shows.
- **Settings** opens from the menu, a Staff home tile, and each calendar day's "Adjust hours" link (`portal.js:810`). All three land at the top of the 4,770 px page.

### Redundant or dead-end screens (Verified)

- **Staff home and Client home** repeat the menu as tiles. They add no information except the calendar and keys to return.
- **Publish updates with no visit in progress** shows only "Start a confirmed visit…" and a link back (`portal.js:457-459`). For a sitter, it's a menu item that is empty most of the day.
- **Book a visit with no pet** stops at "Add your pet to continue" with one link (`portal.js:367-371`, observed). Whether the client returns to booking after adding the pet is **unverified**.
- **The Settings sub-routes** are labelled destinations that don't narrow the page (`portal.js:1024`).
- **Financials** warns that "the portal doesn't track payments collected or refunds" (`portal.js:952`), although payments are recorded per booking. The page is out of date, not dead.

---

## 3. Journey assessment matrix

| # | Journey | Status | Observed path | Problem and impact | Evidence |
|---|---|---|---|---|---|
| A1 | Today → visit preparation | **Friction** | Menu → Today & upcoming → today's card shows time, client, pets, notes, pet profile (collapsed), vaccines, entry details, Start visit | No "active first, then next" ordering; today's cards then a flat list. Feeding, meds, vet and emergency contact aren't on the visit; they need Clients → search → record. Entry details open only near start (by design). | `portal.js:942`, `:584-585`; `care-portal.js:294-350` (no intake); `:646-670` (intake in client record only) |
| A2 | Active visit → care logging | **Friction** | Card: "Publish a diary update" → Publish updates page → pick pet and activity → publish → link "Go to Today & upcoming to complete" | The working context moves between two menu destinations. Each update publishes straight away (fine), but no checklist is drawn from the care plan. Medication records only "given yes/no" plus optional notes, with no required dose or time. | `portal.js:543`, `:437-454`, `:462`; `lib/domain.mjs:31` |
| A3 | GPS walk | **Missing** | Only "Walk started" and "Walk completed" activity entries | No tracking, so nothing is faked and there are no background-tracking limitations to misstate. The solo-sitter audit of Nov 20 listed GPS as a cut; this needs an owner decision, not a nav fix. | `lib/domain.mjs:12` |
| A4 | Complete visit → publish report | **Friction** | Today & upcoming → Complete visit: type a summary, confirm the home is secured, complete. The client is notified on completion (once email exists). | The summary is typed from scratch, not prefilled from logged events. No review of logged versus outstanding tasks. No separate "publish report" step, though updates are already published live, which is arguably better for peace of mind. Doesn't return to the next appointment. | `portal.js:402-421`; `lib/routes/bookings.mjs:267` |
| A5 | Calendar | **Friction** | Staff home shows a 7-day swipe calendar, one day per card. Requests sit in the Today & upcoming list. Hours are edited in Settings. | No single calendar destination: three places together cover it. Week only, one day visible at a time on a phone. Requests aren't grouped. Owners can't create a booking for a client (`Use a customer account to request care`). | `portal.js:789-816`, `:942`; `lib/routes/bookings.mjs:32` |
| A6 | Clients | **Clear** | Clients → search → record with pets, intake, booking history, care history, private notes | Matches the target. Only gap: no link from a visit to its client record. | `care-portal.js:489-500`, `:640-700` |
| C1 | Home → pet → diary | **Friction** | Home (tiles + calendar) → My pets → pet card → "Care history"; or Pet Diary → filter by pet | Home doesn't show an active visit, the next booking or the latest update, although `customerSummary()` computes all three. Two parallel per-pet histories. | `portal.js:845-855`; `assets/visit-state.js:106-118` (unused by portal) |
| C2 | Book care | **Clear for one request / Missing beyond** | Book a visit → service → pets → day → time → notes → price → Review → hold → send. Detours for intake, Meet & Greet, vaccines and agreement are guided and resumable. | Works step by step (covered by booking browser tests). Missing: several appointments in one checkout, recurring booking in the flow (series API has no screen), and Stripe, which is built but off. No-pet start is a detour. | `portal.js:366-401`; `assets/booking-journey-ui.js`; `assets/booking-flow-state.js` |
| C3 | Account and pet care information | **Friction** | Account = tip, packages, password. Pets and household care are separate menu items. | Care information is split across My pets and Care details. Account leads with an automatic tip setting. No receipts list; payment status is only on each booking card. No notification preferences (no email yet). | `portal.js:761-780`; `care-portal.js:184-188` |

---

## 4. Findings

**UX-01 · High · Owner/sitter · Running a visit**
- **Evidence:** logging lives on `#diary` ("Publish updates"); start and complete live on `#upcoming`. Each links to the other (`portal.js:462`, `:543`). The visit card has no intake data (`care-portal.js:294-350`).
- **Why it hurts:** the most frequent task in the business needs two menu destinations, and the safety-critical care plan is a search away.
- **Minimal change:** make `visit/:id` the visit workspace. Reuse `bookingCard()` + `eventForm()` + `staffCareTools()` and add a read-only intake summary (the client-record code at `care-portal.js:654-672` already renders it). After publishing an update, stay on that route. Keep `#diary` as the published feed.
- **Backend:** not required if the intake comes from `GET /api/clients/:id`, which staff can already read. Adding `intake` to the booking payload would save a request but isn't needed.

**UX-02 · High · Owner · Daily orientation**
- **Evidence:** "Staff home" is third in the menu **(observed)** and is 6 tiles repeating the menu (`portal.js:860-867`). `staffWorkQueue()` exists but isn't used (`visit-state.js:125`).
- **Why it hurts:** opening the app doesn't answer "what now?".
- **Minimal change:** turn Staff home into **Today**: active visit first, then today's visits in time order, then requests waiting, built from `staffWorkQueue()` and opening `visit/:id`. Put it first in the menu by reordering the registry or `routesFor()`. Drop the tiles.
- **Backend:** none.

**UX-03 · High · Owner · Settings**
- **Evidence:** 4,770 px, 7 forms on one page **(observed)**. `settings/:group` maps to the whole page (`portal.js:1024`). Calendar "Adjust hours" lands at the top (`portal.js:810`).
- **Why it hurts:** every rare task means scrolling past unrelated forms. Backup and staff accounts sit beside daily hours.
- **Minimal change:** render only the selected group for `settings/hours|services|policies|team|backups` (the registry already defines them), with a short list of groups at `#settings`. Point "Adjust hours" to `#settings/hours`.
- **Backend:** none.

**UX-04 · Medium · Customer · Home**
- **Evidence:** Home = Meet & Greet invitation + 5 tiles repeating the menu + calendar (`portal.js:845-855`, observed 747 px with no information about the client's own care). `customerSummary()` is unused.
- **Why it hurts:** a parent opening the app during a visit can't see that it's happening or what was last posted.
- **Minimal change:** render active care, next booking, latest update and the next action from `customerSummary()` + `nextSteps()`, with one primary "Book care" button. Remove the tiles.
- **Backend:** none.

**UX-05 · Medium · Both · Menus**
- **Evidence:** admin has 7 items + Account; customer has 6 + Account **(observed)**. The menu is generated from the registry's `menu` arrays (`portal-route-state.js:26-48`).
- **Why it hurts:** the menus list features; Pet Diary, Care details and Publish updates compete with daily goals.
- **Minimal change:** change only the `menu` arrays. Routes, deep links and old links stay. See §5.
- **Backend:** none.

**UX-06 · Medium · Customer · Pet and care information**
- **Evidence:** a per-pet history twice (`portal.js:685`; `care-portal.js:473`). Care details is a separate menu item, 1,425 px (observed), holding household intake, agreement and home access.
- **Why it hurts:** clients can't tell where to update "how Cooper eats", or where to read about yesterday's visit.
- **Minimal change:** make the pet page (`pet/:id`) the pet's home, with Diary (the feed filtered to that pet), Care history and Profile in that order. Keep Care details as the household page, reached from My pets and from booking requirements rather than the main menu.
- **Backend:** none. The feed already filters by `pet:` (`portal.js:685`).

**UX-07 · Medium · Owner/sitter · Completing a visit**
- **Evidence:** the summary is a blank required textarea (`portal.js:404`). There's no list of what was logged, and no return to the next visit.
- **Why it hurts:** Myomi retypes what she already logged.
- **Minimal change:** in the visit workspace (UX-01), list that visit's logged updates above the form and prefill the summary from them (editable). After completing, go to Today.
- **Backend:** none; updates are already loaded for the feed. Event-driven "outstanding tasks" from care plans would need backend work (Phase 3).

**UX-08 · Medium · Owner/sitter · Medication safety**
- **Evidence:** a Medication update needs only "given: yes/no"; notes are optional (`lib/domain.mjs:31`, `portal.js:446`).
- **Why it hurts:** a "yes" with no dose or time is a weak record for a safety-critical event.
- **Minimal change:** when Medication is chosen, require a note (dose and time) before publishing, in the form.
- **Backend:** optional server check in `lib/routes/diary.mjs` `reportCard()`.

**UX-09 · Low · Customer · Account**
- **Evidence:** Account starts with "Automatic tip", then packages, then password (`portal.js:761-780`, observed).
- **Why it hurts:** a rare money setting is the first thing in Account. Profile, contact details and payments aren't there.
- **Minimal change:** reorder so contact details and language come first, then payments (link to bookings with balances), then tip and packages, then password.
- **Backend:** none.

**UX-10 · Low · Owner · Calendar requests**
- **Evidence:** requests are mixed into "Other upcoming bookings" (`portal.js:942-943`).
- **Why it hurts:** decisions waiting on Myomi are mixed with routine visits.
- **Minimal change:** list requests first under a "Requests" heading. This comes free with UX-02's work queue.
- **Backend:** none.

**Missing features (not navigation defects):**
- GPS walks.
- A multi-appointment cart.
- Recurring booking in the flow (the series API has no screen).
- Owner-created bookings (blocked at `lib/routes/bookings.mjs:32`).
- A month calendar.
- A receipts list.
- Care-plan checklists.

Each needs a product decision first. The Nov 20 solo-sitter audit recommended cutting GPS and recurring, so don't build these to "complete" navigation.

---

## 5. Proposed information architecture

### Admin

```
Today                    ← staff-home, rebuilt from staffWorkQueue()   [first; default after sign-in]
  └─ Visit (visit/:id)   ← booking card + care plan + log update + complete (UX-01)
Calendar                 ← upcoming (today, requests, upcoming) + 7-day view; history as a filter or link
  └─ Visit (visit/:id)
Clients                  ← clients, client/:id (unchanged)
More                     ← one list page linking to:
  ├─ Hours & dates       settings/hours
  ├─ Services & prices   settings/services
  ├─ Booking rules       settings/policies   (vaccines, agreements)
  ├─ Team                settings/team       (owner)
  ├─ Backups             settings/backups    (owner)
  ├─ Financials          financials          (owner)
  ├─ Published updates   diary               (the feed; logging moves into the visit)
  └─ Account             account
```

### Customer

```
Home                     ← client-home from customerSummary(): active care, next booking, latest update, [Book care]
Bookings                 ← upcoming (upcoming, waiting, past) with pay/cancel/reschedule on each
  └─ Book care           book, book/* (unchanged flow)
  └─ Visit               visit/:id
Pets                     ← pets
  └─ Pet (pet/:id)       Diary (feed filtered to this pet) · Care history · Profile & vaccines
  └─ Household care      care (intake, agreement, home access); also linked from booking requirements
Account                  ← account (contact, language, payments, tip/packages, password)
```

**Why Pets stays a top-level item for customers.** The target puts pet and care management under Account. But the repository's strongest working flow, booking requirements, sends clients to pets and care (`booking-flow-state.js:39-42`), and the target itself wants the diary inside each pet. A Pets destination holding diary and care keeps both without hiding them in Account.

### Retain, move, combine, make contextual

| Existing | Action |
|---|---|
| `staff-home`, `client-home` | **Retain the route, replace the contents** (tiles → current work) |
| `diary` (staff) | **Make contextual:** logging moves into `visit/:id`; the feed stays under More |
| `diary` (customer) | **Combine** into `pet/:id`; keep `#diary` as a redirect or an "all pets" view |
| `history` | **Combine** into Calendar as a past filter or link; keep the route |
| `settings`, `settings/*` | **Retain;** make the sub-routes render only their group |
| `financials`, `account` | **Move** under More (admin) |
| `care` | **Move** out of the customer menu, reached from Pets and booking requirements |
| `visit/:id` | **Promote** to the staff visit workspace |

### Must stay highly visible

- **Start visit** and **Complete visit** (with the departure check).
- **Show entry details.**
- **Approve and decline** a request.
- **Book care** on customer Home.
- **Pay deposit** when a request owes one.
- **Cancel** within terms.
- **Emergency information** (vet, emergency contact, medication) on the visit, not behind Clients.

---

## 6. Phased remediation plan

### Phase 1: grouping, labels, contextual entry, no duplication (no backend API changes)

| Task | Files | Prerequisite | Risk | Acceptance |
|---|---|---|---|---|
| 1a Menu arrays to 4 (admin) / 4 (customer); Today/Home first | `assets/portal-route-state.js` (`menu`, order), `assets/portal.js:935-939` (labels) | none | Low: deep links unchanged; route tests may assert menus | Observed menus match §5; every old hash still resolves (`tests/ux-routing.test.mjs`) |
| 1b Settings sub-routes render one group; `#settings` lists groups | `portal.js:721-760`, `:1024`, `:810` | none | Low | `#settings/hours` shows only hours and date changes; page under ~1,200 px at 390 px; staff browser test still passes |
| 1c Customer Home from `customerSummary()`/`nextSteps()` | `portal.js:845-855` | none | Low | With an active visit, Home shows it and the latest update; with none, the next booking; one "Book care" button |
| 1d Account order (UX-09) | `portal.js:761-780` | none | Low | Contact and language first; tip after payments |

### Phase 2: workflow consolidation and context

| Task | Files | Prerequisite | Risk | Acceptance |
|---|---|---|---|---|
| 2a Staff Today from `staffWorkQueue()` | `portal.js:856-870` | 1a | Low/Med | Active visit first, then today in time order, then requests; each opens `visit/:id` |
| 2b Visit workspace at `visit/:id`: card + log form + intake summary; stay after publishing | `portal.js:437-464`, `:536-588`, `:1027-1040`; `care-portal.js:294-350`, `:654-672` | 2a | Med: two active visits must never mix updates (DUX-07 acceptance) | Start → three updates → complete without leaving the route; intake visible; two simultaneous visits keep separate forms |
| 2c Completion lists logged updates and prefills the summary; return to Today | `portal.js:402-421` | 2b | Low | Summary prefilled and editable; after completing, Today shows the next visit |
| 2d Pet page as pet home (diary filtered + care history + profile) | `care-portal.js:473-488`, `portal.js:665-694`, `:946` | 1a | Med: diary paging per pet | From Home → Pets → Cooper → Diary shows only Cooper; a two-pet visit appears under both pets |
| 2e Medication requires dose/time note | `portal.js:437-454` (+ optional `lib/routes/diary.mjs`) | none | Low | Can't publish Medication "given" without a note; EN/ES message |

### Phase 3: only if the findings above are accepted and decisions are made

- Care-plan checklist per visit, drawn from the intake. Needs a task model (backend).
- Owner-created bookings (lift the `bookings.mjs:32` restriction safely).
- Month view.
- Multi-appointment checkout.
- Recurring booking in the flow.
- GPS. Product decision first; the solo-sitter audit recommends against it.

---

## 7. Next five tasks (priority and dependency order)

1. **Staff Today screen** (UX-02, 2a). Replace the `staffHome()` tiles (`assets/portal.js:856-870`) with the `staffWorkQueue()` list from `assets/visit-state.js:125`. Each item opens `#visit/:id`. Put it first in the staff menu.
   - **Accept:** signing in as owner lands on Today; an in-progress visit is first; requests are listed with Approve/Decline; no menu-repeating tiles; staff browser test passes in EN and ES.
2. **Visit workspace** (UX-01, UX-07, 2b + 2c). On `#visit/:id` for staff, render the booking card, the `eventForm()` for that booking, and a read-only intake summary (reuse `care-portal.js:654-672`). Stay on the route after each update. List the visit's updates above "Complete visit" and prefill the summary.
   - **Accept:** a full visit (start → updates → complete) never leaves the route; feeding, meds, vet and emergency contact visible; two active visits never cross-post; existing departure-check and access-reveal rules unchanged.
3. **Settings by group** (UX-03, 1b). Make `settings/:group` render only its forms, `#settings` a short list, and "Adjust hours" point to `#settings/hours`.
   - **Accept:** at 390×844, `#settings/hours` is under ~1,200 px; backup and staff forms appear only under their groups; old `#settings` links still work.
4. **Customer Home with current care** (UX-04, 1c). Build `clientHome()` from `customerSummary()` + `nextSteps()`, with a single "Book care" button and no tiles.
   - **Accept:** with an in-progress visit, Home shows it and the latest update in one view; with none, the next booking and what's owed; the Meet & Greet invitation still shows for first-time clients; EN/ES complete.
5. **Menus to four destinations** (UX-05, 1a). Edit only the `menu` arrays and labels per §5. Customer: Home, Bookings, Pets, Account. Admin: Today, Calendar, Clients, More (a list page of the settings groups, Financials, Published updates, Account).
   - **Accept:** menus match §5; every existing hash, including `#diary`, `#care`, `#history`, `#financials` and the old `checkout-`/`pet-` links, still opens; `tests/ux-routing.test.mjs` updated only for menu contents.

Tasks 1–4 change only the screens and keep every existing route working. Task 5 is last because it relies on Today, Home and the settings groups being useful destinations first.

---

**Answer to the final question.** Yes. The existing MYO app can become intuitive by reorganizing what it already has:
- The route model supports nesting.
- The summaries needed for Today and Home already exist and are tested.
- Every flow that matters works.

The smallest first changes are a Today list for Myomi, a single visit workspace, and settings split into groups. None of them needs a backend API change.

---

## Progress (November 20, 2026)

Done, with Node and the full Chromium suite passing after each:

- **Task 3 / UX-03, Settings by group** (`4954d46`): `#settings` lists five groups; `#settings/<group>` shows only its forms; "Adjust hours" opens `#settings/hours`. The hours group is 2,295 px at 390 px wide, down from 4,770 px. That's still above the ~1,200 px target, because the weekly-hours form itself is long.
- **Task 4 / UX-04, Client Home** (`78dd9e7`): care in progress, latest update and next booking (with any deposit due) first, then a short to-do list and one "Book a visit" action. The menu tiles are gone.
- **Task 1 / UX-02, Staff Today**: in progress, then today's visits in time order (with "Ready to start"), then requests with Approve/Decline, then money to settle. Every row opens `#visit/<id>`. Today is first in the staff menu. The bookings list is now labelled "Bookings" (was "Today & upcoming").

- **Task 2 / UX-01, UX-07, UX-08, visit page**: staff `#visit/<id>` holds the booking card, the client's care plan (the intake, expanded), the update form while the visit runs, and "Logged so far". Starting a visit opens it, publishing stays on it, and completing returns to Today. The completion summary is prefilled from the logged updates. A Medication update marked given needs a note, enforced in the form and on the server (`medication_details_required`). The diary page's publishing desk still works and links to each visit page. New browser test `tests/browser/visit-workspace-smoke.mjs`, passing on Node and the Worker.

- **Task 5 / UX-05, menus to four**: clients see Home, My bookings and My pets, plus Account in the header. Staff see Today, Bookings, Clients and More. Book a visit is on Home and My bookings. Care details and Pet Diary are on My pets, and each pet's diary link opens the diary filtered to that pet. More lists the five settings groups and Financials (owners), then Booking history and Publish updates. Every old link still opens (`tests/ux-routing.test.mjs`).

All five tasks are done. Not done from the findings: UX-06's full pet page (diary, care history and profile on `#pet/<id>`; the per-pet diary link is the smaller step taken), UX-09 (Account order) and UX-10 beyond Today. The Phase 3 items need product decisions.
