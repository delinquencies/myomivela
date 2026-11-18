# MYO launch iteration — November 18, 2026

This report describes the launch iteration merged with main a725cbd, including its Phase 3 payments, recurring bookings, packages, staff roles and scheduled backups. The production target is Cloudflare Workers with Durable Object SQLite and R2. The frontend uses the existing HTML, CSS and ES modules.

## Completed

- Live quotes, holds, requests and reviewed reschedules use the approved configuration by default. Peak visits replace the regular base, overnight peak charges apply per night, and pet age/species determine puppy and additional-pet lines. Unknown prices from the client are rejected. Existing booked totals change only after a reviewed reschedule.
- Launch mode enforces ten scheduled visits per Massachusetts calendar day. Short notice is measured in Massachusetts calendar days, consistently with the public calculator. A paid request requires saved intake and a completed complimentary Meet & Greet associated with that booking. A cancelled request releases its Meet & Greet for a replacement booking.
- Explicit `MYO_PRICING_MODE=catalog` retains staff-defined catalog prices and the existing booking gates. Older regression fixtures deliberately use this compatibility mode. Dedicated launch integration tests exercise the default business rules.
- All eleven intake and emergency fields persist privately for the owner, with overnight alone-time, behavior and acknowledgment. Staff read them from the customer record. Zero is a valid spending authorization limit. Intake supports longer instructions for multiple pets.
- Vaccine requirements, dates, verification and PDF/image uploads are available through the portal. Booking quotes show translated requirements and links to resolve them. Versioned agreements can be published by staff and accepted by customers in the selected language. The default agreement text is generated from the approved configuration and all sixteen bilingual policy areas, including the peak calendar.
- Customers can save encrypted home-entry details. Staff reveal them only during the existing authorized visit window. Revealed instructions clear on navigation, tab hiding and after sixty seconds. Sensitive fields are excluded from saved drafts.
- Staff can publish activity report fields, including yes/no answers, counts and choices. Clients see role-filtered answers. Overnight updates group under their corresponding nights.
- Pet care timelines, saved profile snapshots, private visit feedback, staff feedback summaries, customer search, paging and client/pet notes are exposed in the portal.
- Overnight booking has a two-month touch calendar with arrival/departure selection, unavailable-night checks and selected-date preservation across language switches.
- Windows restore failures were corrected by allowing the restore CLI to drain output before exit. The vault test now closes its SQLite inspection connection. The Worker test runner supports Windows and isolates Wrangler cache/log files in its temporary directory.

## Data and modules

Schema migration 27 adds `care_intakes`, a booking's Meet & Greet association and primary pet, and the proposed reschedule price. The intake table participates in backup and restore. Main migrations 20–26 are retained. A compatibility bridge upgrades the unpublished local intake schema without losing customer data, covered by a migration regression test.

`assets/care-portal.js` contains the new portal integrations, and `assets/care-copy.js` contains matching English/Spanish labels. `assets/policy-copy.js` generates policy parameters and agreement text from the shared configuration.

## Verification

- Combined Node API and unit suite passed 158 tests.
- Combined Cloudflare runtime run passed 135 tests, with 14 Node-only tests skipped; nine i18n tests encountered a local Wrangler process exit (129). A targeted rerun passed all nine i18n tests and all three launch integration tests.
- The complete Chromium browser suite passed. It includes the existing portal, hold recovery, booking, Meet & Greet, accessibility and bilingual scenarios, plus the new care workflow at 1440×900 and 390×844.
- The new care workflow exercised intake, agreement acceptance, vaccine upload/verification, secure entry instructions, timeline, structured diary publishing, feedback and private staff notes. It checked Spanish accessibility and horizontal overflow.
- Launch tests cover server pricing, stale totals, intake authorization, per-booking Meet & Greet consumption, changed pricing on reschedule, and the daily capacity limit.
- Browser checks found and corrected loss of enriched vaccine information when merging diary pets. The application now preserves that metadata.
- Physical iPhone/Android devices, Safari and a deployed staging site have yet to be exercised.

## Remaining dependencies and work

1. Configure live Stripe credentials and an email delivery driver. Main provides hosted checkout, payment/refund records and an outbox. Launch-specific 50% deposits, the 48-hour expiry and their customer flow remain open. Requests currently use Myomi's existing approval workflow. An explicit backend handoff remains in `assets/myo-launch-backend.js`.
2. Authenticate Wrangler to the intended Cloudflare account, configure the R2 bucket and production secrets, then deploy staging and rehearse backup/restore. `wrangler whoami` reported that this environment is unauthenticated.
3. Choose the production domain and supply the real contact, social and Google review URLs.
4. Test on physical iPhone Safari and Android Chrome, including camera capture, HEIC, software keyboard, rotation and screen readers.
5. Configure the scheduled backup destination and rehearse restore. Main supplies recurring, package and fee-rule APIs; customer-facing management screens remain open. GPS, messaging, password recovery and editing published diary updates remain separate roadmap work.

## Local preview

The development server is running at http://127.0.0.1:45863/ using `.myo/preview-main-41029.sqlite`. Its local vault key is stored in the git-ignored `.myo/preview-main-vault.key` and passed to the server without printing it. Keep the key private with any backups of that preview database.

The earlier Claude and Codex task specifications remain available. This report and the added handoff update record which previously open frontend integrations have been implemented and verified.
