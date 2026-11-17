# myo. site audit and launch plan

Reviewed November 16, 2026. Scope: the homepage and all 16 HTML routes under `myo/` in the local `myomivela` checkout. The site uses static HTML. It can show the customer journey, but the repository has no scheduling service, payment integration, account system, or database.

## What to do next, in order

| Priority | Owner | Work | Done when |
|---|---|---|---|
| P0 | Myomi | Confirm the service towns, business/contact details, launch services and prices. Decide whether each service happens in the client’s home or at another premises. Decide whether the $25 meet-and-greet, $65 Day Stay and recurring walks shown in old mockups are real offers. Treat those mockup values as unapproved. | A one-page service sheet lists each service, location, visit length, rate, mandatory fees, capacity and eligibility. A monitored booking email, phone or approved scheduling URL is supplied. |
| P0 | Myomi + town/insurer | Confirm business and insurance details, permissions for key handling and pet transportation, and whether daycare or boarding requires a kennel license or other local approval. Verify any credential claims before using them. | The business knows which services it can offer, in which locations, and which proof or records are needed. |
| P0 | Myomi + developer | Connect the primary CTA to an actual request channel. Start with request → Myomi reviews → manual confirmation. Collect name, contact, service, town and preferred dates. Keep access codes and detailed pet records out of the initial request. | A real request arrives once, the customer receives confirmation of receipt, and the business can accept or decline without implying a confirmed reservation. Test this in English and Spanish. |
| P0 | Myomi + policy reviewer | Approve the policy decisions below. Publish approved English and Spanish policies and link them from the footer, the booking form and checkout where applicable. | The visible rates, policies and app behavior agree. The customer sees applicable terms before committing. |
| P0 | Developer | Decide which pages go on the public domain. Public launch should expose the homepage, FAQ, approved policies and the real booking destination. Move sample staff/client screens to a preview environment before introducing real data. | A public visitor cannot reach any live client or staff record without authorization. The public sitemap lists only intended pages. |
| P1 | Myomi + developer | Replace the portrait placeholder and sample photos where desired. Approve the Spanish copy, real contact details, business hours and service area. Remove placeholder prices, dates, testimonials and credentials from any route promoted to public status. | Myomi approves the pages in both languages and confirms permission to publish the photos. |
| P1 | Developer | If online payment is needed, use hosted checkout. Start with one-time payments after acceptance, and add recurring charges only when pricing, billing cadence and cancellation are approved. | Test confirmation, declined cards, duplicate callbacks, refunds, cancellation and receipts. No card data passes through the static site. |
| P2 | Developer + Myomi | Build authenticated client and staff features in stages. Start with onboarding and emergency contacts, then booking status, diary photos and reports, then staff tools and recurring schedules. | Each customer only sees their own records. Staff permissions are enforced server-side. Files stay private, and access, changes, retention and deletion are documented. |

## Route-by-route findings

| Page or flow | Current state | Next implementation |
|---|---|---|
| Homepage | Bilingual marketing page with services, Myomi bio, diary teaser and booking CTA. Portrait and contact details still need inputs. | Add approved contact and service area, replace the portrait placeholder, and change the CTA to the real request destination. |
| FAQ | Bilingual answers on visit prep, vet plans, key access and pricing questions. Unverified certification, encryption, staffed support, vet coverage and testimonial copy was removed. | Once approved, add specific eligibility, pricing and cancellation answers with direct policy links. |
| Preview directory | Links to the sample routes without representing them as live tools. | Keep available for internal review. Remove its public footer link for launch. |
| Meet & Greet | Date cards show October 2024. Date/time selection and final confirmation have no booking handler. | Replace sample dates and submit flow with the approved scheduler or request form. Show what happens next on success and provide a retry path. |
| Day Stay | Static sample with unsupported operational claims and indicative pricing. | Confirm whether to offer this service. If approved, rewrite it with verified rates, policies and facility details. |
| Checkout and recurring checkout | Sample totals, payment UI and an agreement line referencing unpublished terms. No payment or billing integration. | Wire hosted checkout after approval. Compute the real total, show terms and cancellation details before payment, and record the accepted policy version. |
| Onboarding: basic info, behavior, health | Three standalone sample screens. No persistence, profile association or completion state. Vaccine upload is mentioned but has no implementation. | Collect only necessary fields after booking. Add save/resume, translations, uploads if needed, access control and clear consent/confirmation. |
| Emergency contact capture and list | Sample contact details and non-persisted controls. | Store contact/vet information in the authenticated workflow. Confirm who may act, how to update details, and when to delete them. Use fake data in previews. |
| Pet profile | Static Cooper record and health notes. | Bind to the authenticated customer’s pet and render real updates with correct permissions. |
| Diary and Walk Diary | Sample timeline, images and route data. No private access, messaging or live tracking. | Decide whether to show photos, approximate routes or exact locations. Add verified photo preferences, private storage, record-level access and redaction of home locations. |
| Stay report | Static report for Cooper. | Connect to completed visits and review reports before release to clients. |
| Sitter dashboard | Publicly reachable sample layout with mock activity. No login, live requests or notifications. | Require staff identity and server-side authorization before connecting real records. Add a queue, status transitions, notifications and an activity log. |

## Policies and procedures to approve

| Policy or document | Decisions to make | Where it belongs |
|---|---|---|
| Service agreement | Legal operator and contact, covered services, visit windows, service area, owner responsibilities, provider responsibilities, keys/access, home conditions, missed access, substitute care if offered, complaints and dispute contact. | Public policy page and acceptance before first paid service. |
| Pricing, cancellations and refunds | Total prices and required fees, how/when payment is taken, cancellations by client or Myomi, rescheduling cutoffs, severe weather, no-shows or inaccessible homes, refund timing, holiday terms and exceptions. | Service or pricing page, booking confirmation and checkout before payment. |
| Recurring care | Billing interval and amount, service cadence, when charges begin, renewals, rate changes, pauses, cancellation steps and reminders as applicable. | Separate consent in recurring checkout and clear instructions in receipts/account. |
| Safety and eligibility | Species and size limits if any, vaccinations/licensing where applicable, aggression and bite history, medication limits, weather and heat thresholds, pet transport, off-leash rules, meet-and-greet requirements, incident escalation. | Public summary, then accepted care instructions for each pet. Review against actual practice. |
| Emergency veterinary authorization | Contact order, preferred clinic, backup plan, transport permission, authorized decision-maker and spending limits or instructions if unreachable. | Private, explicitly accepted by the owner. Record version and date. |
| Privacy notice | Data collected per stage, purpose, recipients/vendors, cookies or analytics used, customer privacy contact, retention and deletion. Cover emergency contacts, photos, addresses, location data and staff access. | Public footer and at the point of collection. Update when vendors or collection change. |
| Photo and location preferences | Define diary-only updates, optional promotional use, location sharing, and how to withdraw permission. Photos for marketing need a separate affirmative choice. | Private preference during onboarding; include a short public explanation. |
| Internal procedures | Key handoff and revocation, lost key and safety incident response, escalation, staff permissions, vendor review, backup/restore, retention and deletion, and response to a suspected data breach. | Internal runbook. Train anyone with access before launch. |
| Accessibility and service contact | Working support channel, how to request help using the site or booking, and who responds. | Footer and contact or booking pages. |

Massachusetts review anchors:

- If dogs are cared for at a premises operated by myo., confirm the official definition, license and municipal rules with the city/town clerk or animal control. The sample Day Stay page makes this a concrete launch decision. [MDAR Ollie’s Law guidance](https://www.mass.gov/info-details/ollies-law-information)
- Review total-price disclosures, cancellation terms and the rules for automatically recurring charges before displaying or accepting a real payment. Have the approved terms reviewed for this business model. [940 CMR 38.00](https://www.mass.gov/regulations/940-CMR-3800-unfair-and-deceptive-fees) · [940 CMR 3.00](https://www.mass.gov/doc/940-cmr-3-consumer-protection-general-regulations/download)
- Map exactly what customer data myo. and its vendors can access. Have the operator review applicability of Massachusetts data security and breach rules for the categories they cover. Treat home access instructions and customer addresses as sensitive in the product regardless of statutory definitions. [201 CMR 17.00](https://www.mass.gov/doc/201-cmr-17-standards-for-the-protection-of-personal-information-of-residents-of-the-commonwealth/download) · [Massachusetts breach notification guidance](https://www.mass.gov/info-details/requirements-for-data-breach-notifications)

## Release checks

This preview pass loaded all 17 routes in Chromium. At 320, 390, and 1440 pixels no page showed horizontal document overflow. The link scan found no broken local links or anchors. Automated accessibility checks at 390 pixels reported no violations. Those checks do not cover screen reader usability or a live booking transaction.

- Run the CSS build. Check every route and local link, then exercise the live booking and policy acceptance flow with test data.
- On mobile and desktop, test keyboard navigation, text zoom, reduced motion, screen reader labels and Spanish copy. Check confirmations, empty states, failures and contact links.
- Run a private-data access review before enabling customer accounts, staff tools, payment records or uploads. `noindex` keeps samples out of the intended search index and does not provide access control.
- Verify hosting HTTPS, published contact details, sitemap, canonical URLs, image rights and current vendor/privacy disclosures on the deployment. Use the approved domain on all public links.
