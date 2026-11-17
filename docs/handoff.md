# myo. project handoff

Run `npm start` on Node 24 to work locally. Setup for the staff account and SQLite database is in the [README](../README.md).

- **Public site:** bilingual homepage and FAQ, swipeable Polaroid service cards, and links to the client portal and staff sign-in.
- **Client portal:** account creation, pet intake, booking requests, and private diary entries grouped by visit with summaries, photos, and manual refresh.
- **Staff portal:** approve requests, start visits, select activities with tap-friendly icon buttons, publish notes and photos, and complete visits. Clients see the same activity icons in their diary.
- **Hosting:** Cloudflare Workers is the intended production target. The runnable preview uses Node and local SQLite. Port the API and storage to Workers, D1, and private R2 before deployment.

The booking flow carries the selected service through intake, and approval checks that the appointment window is still published. The public fictional diary shares the private portal’s visit layout. Verify the complete flow and native camera capture on iOS and Android. Payments, email delivery and password recovery are still open.

The audits describe the state at the time of review. The [design archive](archive/design-previews/myo/index.html) contains old mockups and screenshots, including Scenic Route. It is outside the Node server’s public routes. Include only active pages and assets when publishing to another host.

- [Site-wide audit and launch plan](audits/myo-site-audit.md)
- [Functional requirements audit](audits/myo-functional-audit.md)
- [Follow-up audit and Cloudflare plan](audits/myo-follow-up-audit.md)
- [Pet Diary audit](audits/myo-pet-diary-audit.md)
