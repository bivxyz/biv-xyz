# AI Agency OS landing page

**Current status (October 30, 2026):** LIVE at https://biv.xyz/ai-agency-os (deployment 8d08ec8b). Live checkout is enabled and verified for all three tiers without completing a charge. Signed unpaid webhook verification passed; private files remain protected. Sandbox paid fulfillment, all 33 backend tests, email rendering and final license are verified/approved. See `LIVE-RELEASE.md` for current configuration; sections below preserve earlier implementation history.

Static, buildless addition to the existing Cloudflare Pages site. The canonical route
is `/ai-agency-os`; Pages serves `ai-agency-os.html` at that clean URL. `_redirects`
permanently redirects `/agents` to it. The homepage product card links to this route.

The page follows the supplied v6 build pack, with the current homepage's light/dark
theme tokens, device preference, and persisted `biv.theme.v1` setting. No framework,
runtime dependency, or changes to the newsletter endpoint are required.

## Checkout implementation history (October 29, 2026)

The product page stays in preview: all three purchase controls remain disabled,
including with JavaScript off. A Cloudflare Preview deployment is available at
https://codex-ai-agency-os.bivxyz.pages.dev/ai-agency-os. The live site and live
Stripe catalog have not been deployed or changed by this work. The newsletter
Function and subscribed page are unchanged.

Implemented server-side routes:

| Route | Behavior |
| --- | --- |
| `POST /api/checkout` | Validate tier, origin, available ZIP and configured Stripe Price, then create a hosted one-time Checkout Session and return a 303 redirect. |
| `GET /api/session` | Verify the paid session, product, price, amount and refund/dispute state; return entitlement only, with no buyer email. |
| `GET /api/download` | Reverify payment on every request and stream the entitled private ZIP with no-store headers. |
| `POST /api/stripe-webhook` | Verify the raw-body signature, reread payment from Stripe, record the order, and submit buyer/owner emails with persistent recipient status and retry protection. |

Checkout accepts only the server's configured Price IDs and the expected one-time
USD amounts. A mismatched price, environment, product label or missing ZIP fails
closed. Prices and their Products must carry `metadata.product=ai-agency-os` and
`metadata.tier=playbook|team|dfy`. Historical purchases remain valid if a Price is
later replaced or archived, provided its identity and amount still match.

Every Checkout Session and PaymentIntent receives `product`, `tier`, `source_site`
and `source_page` metadata. The stable product identity is `ai-agency-os`;
`source_site` identifies the domain used for that purchase. A future domain can
reuse the same Stripe objects within the same account and environment; add its
origin using `PUBLIC_SITE_URL` and update webhooks, links and public metadata.

The themed `/ai-agency-os/thanks` page verifies payment before displaying any
file or booking link. It is noindex, no-store and uses no-referrer. The API checks
refunds (including partial refunds) and disputes on every download. A session ID
is a bearer credential: never log it, send it to analytics or include it in other
outbound links. The product and thanks pages use scoped CSP script hashes in
`_headers`; regenerate those hashes if any inline script content changes.

## Configuration reference (historical setup notes)

The AI Agency OS sandbox is connected as `acct_1UVv3uL6LShWDCDl`
(`livemode=false`). All three Products and one-time USD Prices have been created,
read back, and validated against the runtime checks. Their IDs are recorded below.
The live Anchoriq account and production Stripe configuration were not changed.

| Cloudflare variable | Value / purpose |
| --- | --- |
| `STRIPE_MODE` | `test` for Preview; only set `live` at the approved launch. |
| `STRIPE_SECRET_KEY` | Encrypted key for the correct environment; a restricted key is recommended, with Checkout Sessions Write and Prices, Products, PaymentIntents and Charges Read access. Never use the MCP authorization as the site's runtime key. |
| `STRIPE_PRICE_PLAYBOOK` | Environment-specific one-time $79 Price ID. |
| `STRIPE_PRICE_TEAM` | Environment-specific one-time $199 Price ID. |
| `STRIPE_PRICE_DFY` | Environment-specific one-time $1,999 Price ID. |
| `STRIPE_WEBHOOK_SECRET` | Encrypted signing secret for that environment's endpoint. |
| `AIOS_EMAIL_ENABLED` | Exact `true` enables payment-triggered buyer/owner email submission. |
| `BREVO_API_KEY` | Encrypted standard API key with transactional-email access; separate from the MCP credential. |
| `AIOS_CHECKOUT_ENABLED` | Keep unset or `false` until delivery integration and purchase QA are complete. Exact `true` enables the API. |
| `BOOKING_URL` | Optional HTTPS kickoff scheduler; when absent or invalid, Biv reaches out personally with no booking link or promised timeframe. |
| `PUBLIC_SITE_URL` | Optional HTTPS origin for a future domain; current biv.xyz and its Pages preview aliases work without it. |

Register the stable Preview URL's `/api/stripe-webhook` for
`checkout.session.completed` and `checkout.session.async_payment_succeeded`.
Unpaid, failed asynchronous payments, unrelated events, and wrong-environment
payments grant no access. Configure the production endpoint separately at launch.

Webhook records under `orders/<session_id>` are private and atomically created
using R2 `If-None-Match: *`. With `AIOS_EMAIL_ENABLED=true` and a server-side
`BREVO_API_KEY`, fulfillment uses an R2 ETag lease and persistent buyer/owner
message states. The buyer sender and reply address are `Biv <me@biv.xyz>`; owner notifications retain `AI Agency OS <me@biv.xyz>`.
Buyer emails contain the entitled private ZIP and purchase page; Done for you
includes a kickoff link only when a valid HTTPS BOOKING_URL is configured. Owner notifications omit bearer download links.
The initial plain-text content was verified against Brevo's stored sent content. Buyer emails now use the v1.3 HTML copy with hidden preheaders and matching plain text.

Each message persists its exact payload and UUID idempotency key before sending.
Retries within 25 minutes reuse that key (Brevo's deduplication window is 30
minutes). Older ambiguous sends enter `needs_review` and return an error for
operator reconciliation rather than risk another email. Failed sends return 500
for Stripe retry. A successful buyer email is not repeated when the owner send
fails. `delivery_status=submitted` means Brevo accepted both messages, not that
inbox delivery was independently confirmed. Use Brevo events to confirm delivery.
The newsletter integration and its production key remain separate and unchanged.

For a local preview, run `npx wrangler@latest pages dev .` and open the URL printed
by Wrangler. Use `node --test test/checkout.test.mjs` for backend checks. Keep buyer
ZIPs and credentials outside the static output/repository; `.dev.vars` is ignored
by Git and must also be kept out of any manually prepared deployment directory.

After real sandbox purchases, verify all three tiers, declined/3DS/asynchronous
payments, cancellation, refunds, browser and emailed download links, booking,
webhook redelivery, and actual Brevo delivery. Then enable the purchase buttons
and restore the v6 launch copy, remove the preview notice/description references,
and refresh CSP hashes. Require launch approval before pushing or deploying.

## Validation completed

Verified in local Cloudflare Pages with Chrome: 1440px and 390px in light and dark
mode, correct desktop/mobile tier order, no horizontal overflow, all nine FAQ
answers matching JSON-LD, persisted theme across homepage/product navigation,
device theme changes, keyboard skip/focus behavior, and disabled checkout with
JavaScript off. `/agents` returns 301; the clean product URL returns 200.
Axe reports zero WCAG AA/best-practice violations in all four viewport/theme
combinations. The hero's decorative outline produces an incomplete automated
contrast check; text and outline were reviewed visually in both modes.
The newsletter endpoint and subscribed page are unchanged; no live subscription,
payment, or email was triggered during validation.

## Current buyer files: v0.2.8 (verified October 29, 2026)

| Tier | Private R2 object key | Bytes |
| --- | --- | ---: |
| Playbook | `files/AI-Agency-OS-Playbook-v0.2.8.zip` | 2,080,627 |
| Team | `files/AI-Agency-OS-Team-v0.2.8.zip` | 2,332,744 |
| Done for you | Same Team object | 2,332,744 |

Verified both ZIP integrity checks, eight SOPs in each, embedded Playbook PDFs,
editable Markdown, and the Mission Control template. The Team ZIP also has its
Install Guide PDF and Markdown with all eight matching bot URLs. No missing
template-link placeholders or pre-order wording in either README. The separate
Install Guide PDF also contains the eight matching bot URLs. The updated guide has
11 setup steps, including Mission Control; the landing-page inclusion list matches.

SHA-256 checksums for upload verification:

- Team: `5878ddee258188d84915243e05cf3b0659206ab4be9424d0445fad96f2bb9c31`
- Playbook: `0cfbb33b56894d11aa0954a981911ae0a9cd5c9990e53ba374b2595b4373962e`

Drive source IDs (delivery must use private R2, not these source URLs):

- Team ZIP: `1w8-Dnuc_dJnrGEdgSVVptIZZoMdnyUSK`
- Playbook ZIP: `1BuqFXQuBb88IDTqy_yrUNJoJ9jX8GDrN`
- Install Guide PDF: `1tHNXFYIIStdnYTLBxcOKdwAcncdl04lU`
- Playbook PDF: `1b5H4yRSOG7arX-Z6gxbVHLeUXNRqKrR1`

The previous missing-template-link packaging blocker is resolved. R2 upload is
complete. Sandbox payment and email QA is complete; live configuration and launch approval remain outstanding.
No buyer ZIPs or raw bot URLs were added to this repository.

## Cloudflare storage configured October 29, 2026

- Personal Cloudflare account: `f0429275c05d7ed59f82d80bedf15ecc`.
- Private bucket: `aios-files`, Standard storage, Western North America.
- Public r2.dev access is disabled; no custom domains are attached.
- Pages project: `bivxyz` (serves `biv.xyz`).
- `AIOS_FILES` points to `aios-files` in both Preview and Production settings.
- Existing production `BREVO_API_KEY` remains present. Preview now has a separate
  transactional-only Brevo sending secret for purchase email tests.
- Both v0.2.8 ZIPs were uploaded, downloaded through the authenticated API,
  and verified against the SHA-256 checksums above.
- The private binding is now active in the approved Preview deployment. Its
  download route checks Stripe payment and entitlement before serving any ZIP.
  Production has not been redeployed.

## Checkout validation completed

- `node --test test/checkout.test.mjs`: 29 passing backend tests, including price
  tampering, product/environment mismatches, missing ZIPs, refunded/disputed
  payments, all tier entitlements, future-domain attribution, signed webhooks,
  concurrent duplicate delivery, and retriable storage failures.
- Compiled and smoke-tested in local Cloudflare Pages using Wrangler 4.155.0
  and compatibility date 2026-10-29. Confirmed method handling, fail-closed
  checkout, invalid-payment download denial, and private response headers.
- 24 browser cases: all three paid tiers plus unpaid, verification-outage, and
  missing-ID states, at 1440px/390px in both themes; zero automated WCAG AA and
  best-practice violations. JavaScript-off behavior and CSP hashes verified.
- Stripe responses were mocked for backend/browser payment-state checks. Real
  sandbox purchases, real webhook delivery, and actual transactional emails
  remain required. No live payment or email was triggered by these tests.

## Stripe sandbox configured October 29, 2026

Account: AI Agency OS, `acct_1UVv3uL6LShWDCDl`, test environment only.
Both Products and Prices carry `product=ai-agency-os` and their tier metadata.

| Tier | Product ID | Price ID | One-time USD |
| --- | --- | --- | ---: |
| playbook | `prod_VWz5PWIqRWWHqC` | `price_1UVv6rL6LShWDCDlRXRobwvF` | $79 |
| team | `prod_VWz5m8O9yicxtC` | `price_1UVv71L6LShWDCDlhLSd35pP` | $199 |
| dfy | `prod_VWz5Zyp8HujBbd` | `price_1UVv74L6LShWDCDlxonFX8i6` | $1999 |

The three Price IDs, `STRIPE_MODE=test`, and `AIOS_CHECKOUT_ENABLED=false` are
set in Cloudflare Pages project `bivxyz`, Preview environment. The R2 binding
remains intact. Production Stripe settings were not changed and the existing
production Brevo secret remains present.

Created one real sandbox hosted Checkout Session per tier through Stripe MCP
and verified its amount, currency, portable metadata, and hosted checkout URL.
These sessions are unpaid: no card was charged, no payment completion or real
webhook delivery was tested, and no delivery email was sent. The actual expanded
Price objects also pass the application's `validPrice` checks.

The website runtime credential and webhook signing secret are now saved as
encrypted Preview secrets. The MCP authorization remains separate from the site
runtime credential. Restricted runtime keys remain recommended; the application
accepts either Stripe server-key type for the configured environment and rejects
live keys in test mode. Surrounding clipboard whitespace is normalized.

## Approved preview deployment and runtime checks

- Branch: `codex/ai-agency-os` (direct Cloudflare upload; no GitHub push).
- Stable product URL: https://codex-ai-agency-os.bivxyz.pages.dev/ai-agency-os
- Current immutable deployment: https://4aa7120a.bivxyz.pages.dev
- Preview assets were staged from an explicit allowlist. Buyer ZIPs, credentials,
  internal notes and tests were not uploaded as static assets.
- Preview pages include `X-Robots-Tag: noindex, nofollow`.
- The live canonical deployment remains `f4a70537-2e98-4090-8feb-15a8bba6905c`
  on `main`; no production deployment was performed.
- Confirmed the saved Preview runtime key reaches Stripe successfully after
  normalizing clipboard whitespace and supporting both Stripe server-key types.
  An unpaid test-session check returns HTTP 200 with `{paid:false}`.
- `AIOS_CHECKOUT_ENABLED=false`; all three frontend purchase controls remain
  disabled. The deployed checkout endpoint returns the unavailable redirect.
- Deployed page checks pass at 1440px and 390px in both modes. Invalid payment
  IDs cannot download files. Existing backend suite: 29 passing tests.

### Sandbox webhook

- Endpoint ID: `we_1UVvhxL6LShWDCDlOwCtkOzi`, enabled, `livemode=false`.
- URL: https://codex-ai-agency-os.bivxyz.pages.dev/api/stripe-webhook
- Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`.
- API version: `2026-09-30.endive`.
- Signing secret stored directly as encrypted `STRIPE_WEBHOOK_SECRET` in Preview;
  no secret value was written to the repository or displayed.
- Deployed signature probe: correctly signed unpaid event returns 200 ignored;
  invalid signature returns 400. These probes do not create orders or emails.
- A completed sandbox purchase and Stripe-originated delivery are still required
  for end-to-end QA.

Preview `BREVO_API_KEY` and `AIOS_EMAIL_ENABLED=true` are configured. Actual
sandbox purchases and buyer/owner email delivery passed on October 30, 2026.
No live payment was triggered. Purchases are disabled again after QA. See
`LAUNCH-QA.md` for the completed checks and deployment details.


## Purchase email copy v1.3 (October 30, 2026)

Applied the supplied copywriter revisions to buyer subjects and bodies, with Biv
as the buyer sender. HTML includes a hidden preheader and a matching plain-text
version. Owner notifications are unchanged. Done for you defaults to personal
outreach without a response-time promise (explicitly confirmed by Nicholas).
Only a valid configured HTTPS `BOOKING_URL` selects the booking variant; the
previous mailto booking fallback was removed. The confirmation page and product
copy now match this flow, and CSP hashes were refreshed.

The link wording says that the link checks the order each time, rather than
promising unconditional access after a refund. The refund sentence specifies
14 days from purchase. Preview-only deployment `6edbdd9c` contains these changes;
checkout stays disabled. All 33 backend tests pass. Local browser renders of all
four email variants and the existing paid Done for you confirmation were checked.
No purchase email was sent or resent for this copy update; the earlier real email
QA used the previous plain-text version. Verify the final HTML through an actual
email client before live launch.


## License finalized (October 30, 2026)

Nicholas approved the existing license terms without changes. The final source is
`AI-AGENCY-OS-LICENSE.md`. Removed the draft license header/notice and the README's
draft-license references in both v0.2.8 delivery ZIPs. All other ZIP entries,
including PDFs, SOPs, install instructions and bot links, are byte-identical.
Original ZIPs remain preserved locally; original Drive uploads were not changed.
The approved delivery copies are stored in the existing private R2 object keys.
No website deployment or checkout enablement is needed for this file replacement.

Current approved ZIPs (supersede the original checksums above):

| Tier | Bytes | SHA-256 |
| --- | ---: | --- |
| team | 2334895 | `8803c0313cd03e2b109bdc173e2078f1246397d8303d79a0a66d59c851223203` |
| playbook | 2081902 | `1d74dc08f84d83c64a37a6c6fa5800fd781fb3e30dec711f48cff61e37170908` |
