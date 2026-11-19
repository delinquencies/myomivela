# Security and correctness audit — November 19, 2026

**Scope:** server code on `main` at `4e75710` and the two fixes below, with emphasis on what was added in the last three days: payments and deposits, password recovery, guest quotes and ZIP checks, staff roles, scheduled backups, and the booking-flow APIs. The portal's HTML escaping and the Content Security Policy were checked too. **Method:** a route-by-route access review of all 98 API routes, code reading, targeted greps (SQL construction, unescaped output, secrets), `npm audit`, and the existing Node, Worker and Chromium suites. No penetration test, no deployed site.

## Fixed in this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | Medium | A **sitter** could pause, skip or end any client's recurring series through `/api/series/pause`, `/skip` and `/end`. `seriesFor()` accepted any staff account, and skipping or ending cancels bookings, which elsewhere is the owner's decision. | Those routes now require the series' customer or the owner role (403 `owner_only`); sitters can still read series. Test added in `tests/series.test.mjs`. |
| F2 | Medium | The public `/api/availability`, `/api/availability/days` and `/api/availability/times` had no rate limit. Each computes four weeks of start times inside the single Durable Object, so a simple loop could slow the whole API for everyone. | A separate per-address limit of 300 requests a minute (`limitAvailability` in `lib/auth.mjs`); the full browser suite still passes under it. |

## Open, recommended

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| F3 | Medium | **The Worker skips the production safety checks.** `productionProblems()` runs only in `server.mjs`, so on Cloudflare the test-only `MYO_PAYMENTS=fake` and `MYO_EMAIL=log` would be accepted silently (fake "payments" and silently dropped email), and a missing `MYO_VAULT_KEY` only surfaces when someone uses home access or recovery. | Before the first deploy, have the Worker refuse to serve the API with test-only settings unless the test harness sets an explicit flag, and report a missing vault key at start-up. Until then, follow the README's secret list exactly. |
| F4 | Low | Registration says "This email cannot be registered" (409) for an existing account, which reveals who has an account; password recovery is careful not to. | Acceptable trade-off for a small business (the registration route is rate-limited). If it matters, answer registration generically and email the existing account instead, once email works. |
| F5 | Low | Owner actions with the widest reach (adding owners, setting a staff password, restore, refunds) don't ask the owner to re-enter their password. A stolen owner session therefore has full control for up to 7 days. | Add a step-up password check for staff management and refunds; consider a shorter session for staff. |
| F6 | Low | Rate limits and lockouts are kept in memory and reset when the Durable Object restarts (already noted in the README). | Acceptable at this scale; move counters to SQLite if abuse is ever seen. |
| F7 | Info | The CSP allows fonts from `raw.githubusercontent.com` as a fallback, which sends visitors' IP addresses to GitHub if the local fonts fail. | Drop the fallback once the site is deployed and the local fonts are confirmed. |
| F8 | Info | Sitters can read customer records, including contact details and the care intake. This is by design (they run visits). | Confirm with Myomi that every sitter should see full records. |
| F9 | Info | A deposit paid after an unpaid request has expired is recorded and shows as `refund_due`; Myomi refunds it by hand. | By design; mention it in staff guidance. |

## Checked and sound

- **Access control:** every route declares `public`, `user`, `staff` or `owner`; `tests/routes.test.mjs` and `tests/staff.test.mjs` sweep all of them (signed-out 401, customers 403 on staff routes, sitters 403 on owner routes). Customer resources check ownership (`bookingFor`, pets, photos, vaccine documents, ledger, intake, series), and customer-only actions refuse staff.
- **Injection:** all SQL is parameterized; the one interpolated fragment inserts a numeric user id.
- **Output escaping and CSP:** portal and diary HTML escapes user text through `text()`/`escapeHtml`; the CSP is `script-src 'self'` with no inline scripts, `object-src 'none'`, `frame-ancestors 'none'`.
- **Sessions:** random 256-bit tokens, stored as SHA-256 hashes, in `HttpOnly; SameSite=Strict` cookies (`Secure` on https); writes check `Origin`; scrypt password hashes; per-device lockouts.
- **Payments:** Stripe webhooks verify the `t=`/`v1=` HMAC within five minutes and dedupe by event id; card money is recorded only from verified events; refunds can't exceed what was paid; checkout and refund calls use deterministic idempotency keys.
- **Password recovery:** same public answer for every address, 256-bit single-use tokens stored as hashes, 30-minute expiry, a newer link cancels older ones, concurrent redemption succeeds once, all sessions end on reset, and the link is sealed with the vault key until sent and scrubbed after.
- **Deposits and cancellations:** deadlines and fees are computed on the server; a late fee never exceeds the deposit actually paid; staff cancellations keep nothing.
- **Data at rest:** home-entry details are AES-GCM encrypted; backups exclude sessions and reset tokens (they do contain password hashes and must be stored privately); a restore only fills an empty installation.
- **Secrets and dependencies:** no secrets in the repository (`.env`, `.dev.vars` and `.myo/` are ignored); `npm audit` reports 0 vulnerabilities (there are no runtime dependencies).

## Verification

Node 226 passed; the full Chromium chain passed (exit 0) with the availability limit in place. The Worker suite was not re-run for these two small changes; the series and availability tests run on both runtimes in the next full run.
