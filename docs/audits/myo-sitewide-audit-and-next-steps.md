# Myo sitewide audit and next steps

November 17, 2026 · Local working copy based on GitHub main at `50c872b` · For Myomi and the next developer

The local preview supports a full manual booking and care visit. A client can create an account and pet profile, review the price, request a published time, and see the visit and diary after Myomi approves it. Myomi is the only sitter. The main launch gaps are payment and confirmation delivery, approved service terms, Spanish coverage beyond the public landing pages, and release verification on Cloudflare and real phones.

## What was verified

| Surface | Result | Remaining work |
| --- | --- | --- |
| Homepage | English and Spanish switch in place. The hamburger opens by keyboard and closes on Escape. The next controls advance service and testimonial cards, and service links carry the selected service into booking. | Review the copy in both languages, including inconsistent first-person and plural wording in the diary section. Verify swipe gestures on touch hardware. Publish approved rates and service coverage before sign-in. |
| About Myomi | Bilingual page with a working homepage wordmark, booking link, and sample diary link. The page names Myomi as the sole sitter. | Add Myomi’s approved portrait and personal bio details. The heart is a placeholder. |
| FAQ | English and Spanish pages render and the accordion opens by keyboard. | Publish final business answers and link to approved policies. |
| Sample Pet Diary | Example summary and activity timeline use the shared diary renderer. Home and client portal links work. | The sample stays in English after switching the homepage to Spanish. Translate the example, labels, timestamps, and image description. |
| Client portal | Chromium smoke test covered sign-up, pet cards and field validation, tab-local draft recovery, booking and review, cancellation, diary photo and filters, password change, and sign-out. | The portal and its validation messages are English-only. Add Spanish across account, intake, booking, checkout, diary, and service states. |
| Staff portal | Smoke test covered service pricing, published availability, approval, rescheduling, starting a visit, publishing a photo update, completing a visit, and manual backup download. | Add owner-approved lifecycle rules and a delivery channel for booking and visit notifications. The current publishing confirmation appears inside the portal. |
| Responsive layout | Chromium checked four public routes in both language modes and 13 signed-out, client and staff states at 320, 390, 768 and 1280 CSS pixels. The 84 state-and-width checks showed zero horizontal overflow. | Browser width checks do not cover physical touch, phone keyboards, all open menus and error states, or camera handling. |
| Links and accessibility | 23 unique internal link destinations and public anchors resolved. Automated axe checks found zero violations on the homepage, About, FAQ, sample diary and signed-out portal at 390 px in their default states. | Run manual keyboard and screen-reader checks on signed-in flows, open filters and menus, validation, checkout, and checkout expiration. |

### Booking behavior today

1. Clients choose a service, pet, and time from windows Myomi publishes. The server verifies the price, pet ownership, and whether the visit fits.
2. **Review booking** shows the visit and total. It holds the time for up to 10 minutes, with release on editing or expiry. A local check verified that a second client cannot acquire the overlapping hold, that release restores availability, and that an expired hold cannot be submitted.
3. **Send booking request** creates a pending request and releases the hold. A pending request does not reserve the time. Myomi’s approval checks availability again and reserves the appointment. My bookings shows the status.
4. Myomi starts and completes the visit and publishes updates. The client diary shows the timeline and completion summary.

The review page and the temporary hold are prerequisites for instant booking. The current flow does not charge, invoice, email a receipt, or confirm a paid booking automatically. Published hours and prices belong to Myomi. The archived checkout screens are design references. The single-visit summary in the portal uses real appointment and quote data.

### Release verification

- `npm run test:browser` passed against Node at a 390 × 844 viewport. The intentional dropped connection during diary publication recovered with one saved update.
- `npm run build:site` passed and copied 34 public files, including the About page.
- `npm test` passed 44 of 49 tests on Windows. Three assertions in `tests/backup.test.mjs` and `tests/operations.test.mjs` still expect schema 6 after the checkout hold migration raised the app to 7. The failures report a version mismatch. Two restore CLI tests received Windows exit code 3221226505 where they expected 1. The same two restore failures were reproduced earlier on the clean baseline. The current Windows suite is not green.
- The current checkout was verified locally. The Worker suite, deployed Cloudflare environment, Safari, Firefox, real Android Chrome, iPhone camera capture, and HEIC uploads were outside the verification completed for this revision.

## Next steps in order

| Order | Owner | Work and completion check |
| --- | --- | --- |
| 1 | Developer | Update the three schema assertions while keeping the migration and backup checks meaningful. Reproduce the Windows restore exit behavior, confirm the expected refusal and diagnostic, and rerun Node and Worker tests before release. Rehearse restoring a version-7 backup with a diary photo into an empty staging installation. Keep temporary holds out of restored operational data. |
| 2 | Myomi and developer | Approve the rate card, service areas, lead time, travel buffer, hours, and the exceptions Myomi wants to approve herself. Publish price and duration before sign-in once the rate card is approved. Mark published times as instant-bookable only after provider tests pass. |
| 3 | Myomi and policy reviewer | Approve and publish service terms, pricing and fees, cancellation and rescheduling cutoffs, missed access and no-shows, cancellations by Myomi, weather, refund timing, emergency and vet authorization, keys and access, privacy, records retention and deletion, and private diary photo permissions. Decide whether public photo and testimonial permission should be requested separately. Provide equivalent English and Spanish terms, link them at booking and checkout, and record the accepted version before payment. |
| 4 | Developer, with Myomi’s provider choice | Integrate hosted one-time payment for published slots. The client selects a visit, reviews the final total, and pays in the hosted checkout. Tie the provider session to the server-side hold. Treat verified payment events as the source of truth, record payment status durably, and confirm the visit automatically after payment. Preserve manual requests for the exceptions Myomi defines. Test double booking, repeated and late payment events, expired or abandoned checkout, payment failure, amount changes, refunds, and cancellation. Never display a paid state based solely on a browser redirect. |
| 5 | Developer, with Myomi’s sending domain | Send a confirmation and receipt for paid visits so the client can close the browser. Send status messages for manual requests and cancellations, and a new-request alert for Myomi. Add password recovery and any email verification with the same sending setup. Log delivery outcomes and verify retries do not send duplicate messages. |
| 6 | Developer and bilingual reviewer | Translate the sample diary first so the Spanish homepage has a consistent preview. Add a persistent Spanish choice to client and staff login, portal navigation, intake tips and errors, booking and payment states, visit activity labels, email, and policies. Keep clients’ and Myomi’s free-text notes as entered. Test the full flow in both languages, including long labels and date/currency formatting. |
| 7 | Developer | Stage on Cloudflare Worker, Durable Object, and R2 with separate data and sandbox credentials. Run the current Worker suite, then test HTTPS sign-in, permissions, restore, and a visit with a real device photo on staging. Schedule backups to a separate destination and test recovery. Set the public domain and update sitemap and robots entries that still point to GitHub Pages. Confirm CI covers the adopted checks. |
| 8 | Developer and Myomi | Test on iPhone Safari and Android Chrome, plus desktop Safari and Firefox. Watch both people complete a booking and diary handoff without being coached. Check one-handed use, open pickers, keyboard focus, zoom, interrupted checkout, and camera/photo upload. Agree on HEIC support or give clear guidance when it cannot be used. |
| 9 | Myomi | Provide approved contact and social URLs, portrait, and Google profile and review-request links. Set the `read` URL for the visible testimonial footer button and the `write` URL for the optional client Account link. Decide when to invite clients to review. Keep example cards labeled until approved real quotes and permissions are available. |

Recurring visits and packages, tips, diary editing, care checklists, structured medication records, messaging, staff customer search, and GPS tracking remain in the existing backlog. Prioritize them separately once a single visit can be booked, paid for, delivered, and recovered end to end.

## Relationship to the previous audit

This report supplements `MYO_AUDIT.md`, `DEVELOPMENT_HANDOFF.md`, `docs/handoff.md`, and the notes under `docs/audits/`. Those files retain their original findings and remediation history.

- **N3, D1 and S4.** The current Chromium run supports the local portal test, published-window scheduling, and CSP behavior described in the remediation. Real devices, alternate browsers, and the current Worker build remain separate checks.
- **P1-5 and O2.** Structured pet profiles, card-by-card intake and tab-local draft recovery were exercised. Business decisions about which care and emergency fields are required remain open.
- **P1-7.** The single-visit review screen and temporary hold now exist. A provider, paid confirmation, receipts and refunds remain open.
- **S5 and P1-6.** Password change and sign-out-everywhere passed in the browser. Email verification and account recovery remain open.
- **P0-5, P0-6, O1 and P1-8.** Manual backup download passed. Cloudflare remains the target. Current schema test failures, first deployment verification, scheduled off-account backups, restore rehearsal and final indexing URLs remain open.
- **D2 and P1-4.** Current request and visit transitions worked in Chromium. Policies for early starts, no-shows, rescheduling, cancellations and refunds still need approval and enforcement.
