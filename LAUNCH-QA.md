# AI Agency OS — launch QA

**Current status:** Live deployment 8d08ec8b is serving biv.xyz with checkout enabled. Live runtime key, all three unpaid hosted Checkout sessions, amounts, attribution, return URLs, download denial and webhook signing were verified. No live charge was made. The current suite has 33 passing tests; all three v1.3 emails and the final license were approved. `LIVE-RELEASE.md` is the current handoff. The sandbox evidence below records the earlier paid test run and original ZIP hashes.

Completed October 30, 2026. Scope: Cloudflare **Preview** and the **AI Agency OS Stripe sandbox** only. No live charges or production deployments were performed. Git changes remain local and uncommitted.

## Result

The three one-time tiers passed payment → Stripe webhook → private order → Brevo buyer/owner email → entitled download checks. Purchases were disabled again after testing.

| Check | Evidence / result |
| --- | --- |
| Playbook $79 | Paid through hosted sandbox Checkout using Stripe's successful test card; confirmation page showed Playbook entitlement. |
| Team $199 | Paid through hosted sandbox Checkout with a 3D Secure test card; displayed and completed the test challenge. |
| Done for you $1,999 | Paid through hosted sandbox Checkout; confirmation included Team download and kickoff booking link. |
| Stripe-originated fulfillment | All three actual `checkout.session.completed` events show `pending_webhooks=0`; their private R2 orders show both recipient sends accepted. |
| Buyer email delivery | Brevo reports `delivered` for all three tier emails to the owner's Gmail plus aliases. Subjects start with `[TEST]` and explicitly identify sandbox purchases. |
| Owner notifications | Brevo reports `delivered` for all three notifications to `me@biv.xyz`. |
| Playbook download | Browser download and HTTP download matched the stored v0.2.8 SHA-256 checksum. |
| Team download | Matched the stored v0.2.8 SHA-256 checksum. |
| Actual emailed links | Retrieved the sent Team and Done for you email bodies from Brevo; verified direct private download URLs, retrieved both ZIPs and matched checksums. Done for you email includes kickoff instructions. |
| Provider duplicate request | Replayed the exact Team buyer-email request with its original UUID idempotency key. Brevo returned `duplicate_parameter`; no duplicate email was submitted. |
| Declined card | Stripe displayed the expected decline for Done for you; its unpaid session's download request returned 403 before a later successful retry. |
| Cancellation | Checkout's back link returned to the product with “Checkout cancelled. Nothing was charged.” Cancelled session download returned 403. |
| Partial refund | Refunded $1 of the sandbox Playbook payment; its previously working download returned 403. |
| Full refund | Refunded the remaining $78; the download continued to return 403. These are sandbox refunds, with no real money movement. |
| Wrong entitlement | A Team purchase requesting the Playbook ZIP returned 403. |
| Automated failure/retry checks | 29 passing tests, including concurrent duplicate webhooks, independent owner retries, provider acceptance followed by storage failure, retry with the same key, and ambiguous sends beyond the deduplication window. |
| Compilation | Cloudflare Pages Functions bundle compiled successfully with Wrangler 4.155.0. |

ZIP hashes:

- Playbook: `0cfbb33b56894d11aa0954a981911ae0a9cd5c9990e53ba374b2595b4373962e`
- Team / Done for you: `5878ddee258188d84915243e05cf3b0659206ab4be9424d0445fad96f2bb9c31`

## Email configuration and retry behavior

`AI Agency OS <me@biv.xyz>` is a verified sender. The domain is verified and authenticated with DKIM and DMARC. A separate restricted standard sending key is encrypted in Cloudflare Preview; the Brevo MCP key is stored in macOS Keychain and is not used by the website. The existing production newsletter integration was not changed.

Fulfillment persists each recipient's exact request and idempotency key before sending. R2 conditional ETag writes coordinate concurrent webhook deliveries. Accepted recipient sends are skipped on later retries. Brevo's deduplication is limited to 30 minutes; automatic ambiguous-send retries stop after 25 minutes and leave `needs_review` for operator reconciliation. This deliberately does not promise exactly-once delivery across an unlimited provider outage. `submitted` records API acceptance; delivery confirmation comes from Brevo events.

For an order in `needs_review`, inspect Brevo's events and sent content for the stored recipient, subject, and request time before changing its state. If a message was accepted, reconcile its message ID; do not blindly generate a new key or resend after the provider deduplication window. A confirmed failure can be explicitly retried after reconciliation. Stripe receives a 500 while an order still requires attention.

## Remaining work at the initial sandbox test (historical)

- Configure live Stripe products/prices, runtime credentials, and production webhook.
- Configure production purchase-email delivery independently of the existing newsletter key.
- Set a calendar `BOOKING_URL` if desired. The tested current fallback opens an email to `me@biv.xyz` for arranging the kickoff; it is not a calendar reservation.
- Restore purchase copy, enable controls and gate only as part of the approved live release.
- Review and approve source publication and the production deployment.
- License approval is complete; the final license source is `AI-AGENCY-OS-LICENSE.md`.

Delayed asynchronous payment methods were covered by handler/unit tests, not a real delayed-method Checkout purchase. A manual Stripe Dashboard webhook resend was not performed; duplicate webhook behavior was tested automatically, and actual Brevo request deduplication was tested against the provider. No live-mode payment or deliverability guarantee is implied by sandbox QA.

Production deployment ID was `3beb672d-153b-4f08-b843-6fe0d2d55f4c` both before and after this work. Stable preview: https://codex-ai-agency-os.bivxyz.pages.dev/ai-agency-os.


## Subsequent copy update — v1.3 (initial validation)

Buyer emails and the personal-outreach flow were updated after the sandbox QA
above. The current suite has 33 passing tests. All four email variants were
rendered locally; hidden preheaders, matching text, safe link encoding, tier
entitlements, unchanged owner notifications, and configured/unconfigured booking
behavior were checked. The current preview deployment is `6edbdd9c`; its paid
Done for you page uses personal outreach when no calendar URL is configured.
The older sandbox screenshots and sent messages above retain their original copy.
No new messages were sent for this copy revision; an actual email-client check
of the revised HTML remains part of release validation.


## Approved license packaging update

Nicholas approved the existing terms on October 30, 2026. Both delivery ZIPs were
updated to remove draft-license labels from LICENSE.md and README.md only. All
other entries remain byte-identical. The current approved ZIP checksums are in
LANDING-PAGE.md; the earlier sandbox download checks above used the original
packaging. The included PDFs did not contain draft-license statements and were
not edited. Drive source uploads remain unchanged.


## Final email approval — October 30, 2026

All three [PREVIEW v1.3] tier emails were sent to Nicholas’s Gmail alias. Brevo reported delivery for all three; Nicholas then explicitly confirmed “All three look right.” These messages used clearly marked example links, so this validates email rendering and copy, not a new paid download. The earlier sandbox run validates actual purchase links. Done for you uses personal outreach without a timing promise. Latest release-candidate preview: `d5403223`; checkout remains disabled.


## Production smoke check

Deployment cc201c80 passed public-page source matching, private download denial, /agents redirect, method guards and unsigned webhook rejection. Checkout remains closed. Live Stripe runtime verification is blocked by stripe_key_environment_mismatch (test key saved in Production); no live Checkout or charge was completed. See LIVE-RELEASE.md.


## Live checkout verification complete

The corrected live key resolved the environment mismatch. All three live Checkout sessions were open/unpaid, with correct amounts and biv.xyz return URLs. Runtime session reads worked; unpaid downloads returned 403. Browser homepage → product → Team Checkout → cancellation passed. Correctly signed unpaid webhook was accepted and ignored, with no order/email. Checkout is enabled on deployment 8d08ec8b. No live paid fulfillment was exercised.
