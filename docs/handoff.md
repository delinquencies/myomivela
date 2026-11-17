# myo. project handoff

Run `npm ci`, `npm run build`, and `npm start` to work locally. Setup for the staff account and SQLite database is in the [README](../README.md).

- **Public site:** bilingual homepage and FAQ, swipeable Polaroid service cards, and links to the client portal and staff sign-in.
- **Client portal:** account creation, pet intake, booking requests, and private diary entries grouped by visit with summaries, photos, and manual refresh.
- **Staff portal:** approve requests, start visits, select activities with tap-friendly icon buttons, publish notes and photos, and complete visits. Clients see the same activity icons in their diary.
- **Hosting:** Cloudflare Workers is the intended production target. The runnable preview uses Node and local SQLite. Port the API and storage to Workers, D1, and private R2 before deployment.

Prioritize the booking handoff from a service card through sign-in and pet intake. Recheck that staff cannot approve a request for a withdrawn slot. Then replace the standalone public diary mockup with a sample that matches the live portal, and verify native camera capture on iOS and Android. Payments, email delivery and password recovery are still open.

The audits are snapshots. Since the diary review, the private feed gained visit grouping, summaries, a refresh button, and shared activity icons. The public sample still needs the layout update.

- [Site-wide audit and launch plan](audits/myo-site-audit.md)
- [Functional requirements audit](audits/myo-functional-audit.md)
- [Follow-up audit and Cloudflare plan](audits/myo-follow-up-audit.md)
- [Pet Diary audit](audits/myo-pet-diary-audit.md)
