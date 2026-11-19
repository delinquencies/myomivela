# Security and correctness audit — November 19, 2026

**Scope:** server code on `main` at `4e75710` and the four fixes below, with emphasis on what was added in the last three days: payments and deposits, password recovery, guest quotes and ZIP checks, staff roles, scheduled backups, and the booking-flow APIs. The portal's HTML escaping and the Content Security Policy were checked too. **Method:** a route-by-route access review of all 98 API routes, code reading, targeted greps (SQL construction, unescaped output, secrets), `npm audit`, and the existing Node, Worker and Chromium suites. No penetration test, no deployed site.

## Fixed in this audit

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | Medium | A **sitter** could pause, skip or end any client's recurring series through `/api/series/pause`, `/skip` and `/end`. `seriesFor()` accepted any staff account, and skipping or ending cancels bookings, which elsewhere is the owner's decision. | Those routes now require the series' customer or the owner role (403 `owner_only`); sitters can still read series. Test added in `tests/series.test.mjs`. |
| F2 | Medium | The public `/api/availability`, `/api/availability/days` and `/api/availability/times` had no rate limit. Each computes four weeks of start times inside the single Durable Object, so a simple loop could slow the whole API for everyone. | A separate per-address limit of 300 requests a minute (`limitAvailability` in `lib/auth.mjs`); the full browser suite still passes under it. |
| F3 | Medium | **The Worker skipped the production safety checks.** `productionProblems()` ran only in `server.mjs`, so on Cloudflare the test-only `MYO_PAYMENTS=fake` and `MYO_EMAIL=log` would have been accepted silently, and a missing `MYO_VAULT_KEY` only surfaced when someone used home access or recovery. | The shared checks are now `workerProblems()` in `lib/config.mjs`. While any applies, the Durable Object answers every API call except `GET /api/session` with 503 `not_configured`, its alarm sends nothing, and the reasons go to the Worker log. Only the test harness's `MYO_TEST_SETTINGS=1` allows the test-only settings. Worker test added in `tests/operations.test.mjs`. |
| F5 | Low | Owner actions with the widest reach (adding owners, setting a staff password, restore, refunds) didn't ask the owner to re-enter their password, so a stolen owner session had full control for up to 7 days. | Those routes (staff changes, backup download and restore, refunds) now need a password entered in the last 15 minutes (`recentAuth` in the route table, `POST /api/reauth`, migration 32); the portal asks in a dialog and retries. Node, Worker and browser tests added. Staff sessions still last 7 days; shortening them is left as an option. |

## Open, recommended

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| F4 | Low | Registration says "This email cannot be registered" (409) for an existing account, which reveals who has an account; password recovery is careful not to. | Acceptable trade-off for a small business (the registration route is rate-limited). If it matters, answer registration generically and email the existing account instead, once email works. |
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

Node 226 passed; the full Chromium chain passed (exit 0) with the availability limit in place. After the F3 and F5 fixes: Node 228 passed, the Worker suite 206 passed (23 Node-only skips), and the full Chromium chain passed (exit 0), including the new password prompt in the staff test.
