# myomivela

myo. is Myomi’s pet-care website and portal. Customers can request a visit and read their private Pet Diary. Staff can publish availability, approve requests, start and complete visits, and post activity updates and photos.

## Run locally

Install Node.js 24 and run the following from the repository root. The current site and portal use checked-in CSS and have no install or build step for local preview.

```sh
npm start
```

Open [the local homepage](http://127.0.0.1:45838/). Use separate browser profiles or a private window for the [client portal](http://127.0.0.1:45838/portal/) and [staff sign-in](http://127.0.0.1:45838/portal/?staff=1#diary) so they keep separate sessions.

### Create a test staff account

Set `MYO_ADMIN_EMAIL` and `MYO_ADMIN_PASSWORD` in the terminal before starting the server. Use a unique password of 12–128 characters. Use fictional customers and a separate SQLite database for testing.

PowerShell:

```powershell
$env:MYO_ADMIN_EMAIL = 'staff@example.test'
$env:MYO_ADMIN_PASSWORD = 'replace-with-a-unique-test-password'
$env:MYO_DB = '.myo/preview.sqlite'
npm start
```

macOS or Linux:

```sh
export MYO_ADMIN_EMAIL='staff@example.test'
export MYO_ADMIN_PASSWORD='replace-with-a-unique-test-password'
export MYO_DB='.myo/preview.sqlite'
npm start
```

On startup, the server creates the staff account if the configured email does not already exist in the selected database. Changing the password variable leaves the existing account password intact. SQLite defaults to `.myo/data.sqlite`. The server listens on `127.0.0.1:45838` by default. `HOST` and `PORT` override the listener. Use the exact `MYO_ORIGIN` and `MYO_SECURE_COOKIES=1` when testing the Node server behind HTTPS. Keep the database on private storage.

### Test a booking and diary update

1. Sign in as staff. Under **Services & availability**, set a test price and duration and publish a future appointment window long enough for that service. Staff enter the window in their device’s local time. Customers see Massachusetts time.
2. Open a service card as a new customer. Register, add a pet, and verify that saving the pet returns you to the selected service. Choose an appointment and submit a request. The request awaits staff confirmation.
3. Approve the request, start the visit, publish a diary update with a photo, and complete the visit with a summary. Verify that the customer sees it under **Pet Diary** and that another customer cannot open the update or photo.
4. With a fresh request, remove its appointment window and verify staff approval is rejected. Check that an already confirmed booking stays confirmed and that overlapping requests cannot both be approved.
5. On iPhone and Android, test one-handed use, the camera and photo-library buttons, and the customer’s diary refresh. This device pass is still open.

## What works today

- Bilingual homepage and FAQ, service cards linked to booking, and a fictional diary sample based on the private portal layout.
- Customer registration and sign-in, pet profiles, booking requests, cancellation and rescheduling, and private visit summaries, activity updates, and photos. The portal currently uses English.
- Staff pricing and availability, booking approval, visit tracking, and tap-friendly diary publishing. **Walk started** and **Walk completed** record diary activities.

## What’s left to figure out

| Area | Next decision or work |
| --- | --- |
| Service area and pricing | Confirm towns or ZIP codes, launch services, visit lengths, hours, capacity, fees, and the booking contact. The proposed rates for client review are **$30 for a 30-minute walk**, **$35 for a 30-minute drop-in**, and **$110 per in-home overnight**. Confirm overnight coverage and included daytime visits. |
| Care and booking policies | Approve cancellation, rescheduling, refund and payment timing. Decide which feeding, allergy, medication, vet, and emergency contact details are needed before approval or visit start. Confirm home access, emergency authorization, photo and location consent, and retention. Publish the approved policies and add field-level care validation. |
| Launch content | Supply approved contact and social links, portrait and photos, and testimonials with permission and attribution. Review the public English and Spanish copy. |
| Production hosting | The current backend runs on Node and SQLite. The intended production setup is Cloudflare Workers with D1 and private R2. Stage HTTPS, sessions, concurrent approvals, private media access, backups and restore, and the public routes and sitemap. GitHub Pages can serve static files only. |
| Account and payment features | Add email verification, password recovery, booking emails, and Spanish portal copy. Choose a payment provider and add hosted checkout after payment timing and refund rules are approved. |
| Staff app and GPS | If Myomi wants walks to track with the phone locked, prototype a small native staff app on her phone. Decide what route data to retain and what customers may see. The current portal records neither GPS routes nor distance. |
| Diary follow-up | Verify native camera capture and end-to-end publishing on phones. Decide how staff correct a published update and add a last-updated indicator. Revisit server-side filtering and pagination as history grows. |

See the [handoff](docs/handoff.md) and [four audits](docs/audits/) for the earlier findings. The [design archive](docs/archive/design-previews/) holds the retired mockups and screenshots, including the Scenic Route GPS concept. The Node server serves the active FAQ and fictional Pet Diary sample under `myo/`. Archived routes are outside the served site.

If you edit the archived prototypes, rebuild their Tailwind stylesheet with `npm ci` followed by `npm run build`.
