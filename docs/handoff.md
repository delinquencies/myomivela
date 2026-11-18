# Myo project handoff

The [development handoff](../DEVELOPMENT_HANDOFF.md) is the current technical reference. It includes the [usability and UX test brief for Claude](../DEVELOPMENT_HANDOFF.md#7-usability-and-ux-test-for-claude).

- **Run locally:** use `npm start` with Node 22.13 or newer. The [README](../README.md) covers staff setup, tests, and Cloudflare staging.
- **Production target:** Cloudflare Worker, Durable Object SQLite, and private R2. Node uses the shared backend with local SQLite and photo files. First real deployment and phone testing are still open.
- **Booking:** staff publish weekly hours, date exceptions, and extra windows. Customers can preview times and prices, hold a time briefly for review, and send a request for approval.
- **Pet Diary:** the public sample and private portal share the visit layout. Staff can publish private activity notes and photos. Payments, email and password recovery remain open.

Start with the [sitewide audit](audits/myo-sitewide-audit-and-next-steps.md) and [UX friction log](audits/myo-live-ux-friction-log.md). The [main audit](../MYO_AUDIT.md) and [earlier audits](audits/) preserve findings and remediation history. The [design archive](archive/design-previews/myo/index.html) holds retired prototypes and is outside the served site.
