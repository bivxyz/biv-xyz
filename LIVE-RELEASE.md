# AI Agency OS release handoff

Status: October 30, 2026. LIVE at https://biv.xyz/ai-agency-os. Production checkout and purchase emails are enabled. Live runtime key verification and unpaid live Checkout checks passed for all tiers. No live charge was made; paid fulfillment was validated in the sandbox.

## Approved and verified

- Three sandbox tiers passed hosted payment, webhook, email and private-download QA. See LAUNCH-QA.md for actual versus automated coverage.
- 33 backend tests pass. Final source has enabled purchase controls and launch copy; only the staged Preview copy disables controls and adds its release-candidate notice.
- Nicholas approved all three v1.3 email previews in his mail client. Done for you has personal outreach with no timing promise; an optional valid HTTPS BOOKING_URL selects booking copy.
- Final license approved and packaged in private R2 ZIPs. Current hashes are in LANDING-PAGE.md.
- Latest main changes through 5bac4f43b4c0853f280832fc0be246e9766eddaf were merged cleanly into codex/ai-agency-os, preserving the updated homepage tool references.
- Preview deployment d5403223: https://codex-ai-agency-os.bivxyz.pages.dev/ai-agency-os. Preview has global noindex and disabled purchase controls.

## Production configuration

Cloudflare personal account f0429275c05d7ed59f82d80bedf15ecc; Pages project bivxyz; production branch main. Current canonical deployment remains 3beb672d-153b-4f08-b843-6fe0d2d55f4c.

Stripe live account: Anchoriq, acct_1MDCeGLua7yiYaAR. Products and Prices carry product=ai-agency-os and tier metadata. Amounts are one-time USD.

| Tier | Product | Price | USD |
| --- | --- | --- | ---: |
| playbook | prod_VXRJ5VBBpXHMJU | price_1UWMQaLua7yiYaARlUuB3amw | 79 |
| team | prod_VXRJQoiIuZhaB8 | price_1UWMQcLua7yiYaARTHzNWOTF | 199 |
| dfy | prod_VXRJOviU0vgrzi | price_1UWMQfLua7yiYaARTLlldKNK | 1999 |

Live webhook we_1UWMRCLua7yiYaARNPG3TQxj points to https://biv.xyz/api/stripe-webhook, listens for checkout.session.completed and checkout.session.async_payment_succeeded, and uses API version 2026-09-30.endive. Its signing secret is encrypted in Cloudflare Production.

Production has STRIPE_MODE=live, these three Price IDs, AIOS_EMAIL_ENABLED=true and AIOS_CHECKOUT_ENABLED=false. AIOS_FILES binds the private aios-files bucket. Existing encrypted BREVO_API_KEY and newsletter integration are preserved. Existing STRIPE_SECRET_KEY is masked: its live mode and permissions have not been verified. Nicholas has been asked to save a live restricted key with Checkout Sessions Write and Prices, Products, PaymentIntents and Charges Read. Never paste keys in chat or commit them.

## Release artifact and remaining steps

Production allowlist staged at /tmp/biv-aios-production-release with SHA-256 manifest /tmp/aios-live-prep/release-manifest.json. It contains public static assets and Pages Functions only; no ZIPs, credentials, tests, or internal notes. Production headers do not apply Preview’s global noindex; the thank-you page remains private/noindex.

1. Confirm the Production runtime Stripe key is live and correctly scoped.
2. Deploy the prepared release to Production with checkout closed initially; verify live Stripe access and private endpoint guards on biv.xyz.
3. Enable checkout for the launch and verify hosted live Checkout amounts and domain return URLs without completing a live charge. Verify homepage navigation, delivery origin, headers, and unchanged newsletter behavior.
4. If checks fail, keep checkout closed and fix the cause before opening sales. Retain the previous deployment for rollback.

Live purchases have not been tested. Sandbox evidence does not establish live-mode runtime access. Manual Stripe Dashboard resend and actual delayed-method Checkout were not performed; handler retry behavior and asynchronous completion are covered automatically.


## Production deployment and blocked checkout verification

Deployment cc201c80-1f2b-4271-97d8-7dd43fa2aafb is now canonical. The homepage, product, thank-you and subscribed HTML match the staged source exactly. Product response has no global noindex; private routes retain no-store. /agents redirects 301. Requests without payment cannot download either tier (403), wrong methods return 405, unsigned webhook requests return 400, and the checkout gate returns its unavailable redirect.

The live-format verification probe returned 503; sanitized function logs identify stripe_key_environment_mismatch, before any Stripe request. Checkout remains false. After the live key is saved, redeploy to refresh runtime secrets, repeat verification, then enable checkout and verify live hosted Checkout for all tiers without completing a charge.


## Live release verification — completed

Canonical deployment: 8d08ec8b-c0f1-4495-9d18-61722edc70be. Production STRIPE_MODE=live, AIOS_CHECKOUT_ENABLED=true, AIOS_EMAIL_ENABLED=true. The corrected live runtime key passed session retrieval. All three website POST /api/checkout requests created hosted live sessions with the expected amounts ($79/$199/$1,999), one-time USD prices, quantity one and portable product/tier/source metadata. Stripe readback confirmed livemode=true, open/unpaid status and biv.xyz success/cancellation URLs. Unpaid sessions returned paid:false and download 403 through the actual live runtime.

Browser check followed homepage card → product → The Team → hosted Stripe Checkout ($199). Cancellation returned to biv.xyz with the expected no-charge message. A correctly signed live-format unpaid webhook returned received:true/ignored:true; unsigned requests are rejected. This probe creates no order or email. Stripe Checkout currently displays ANCHOR IQ as merchant branding; that existing account setting was not changed.

No live paid transaction was completed. Paid webhook fulfillment and actual buyer/owner delivery were verified in the sandbox; v1.3 rendering was separately approved by Nicholas. Saved local Checkout references are private operational artifacts outside the repository. The earlier blocked-key entries above record resolved history.
