import { FILES, tierConfig, siteOrigin, returnToPricing, stripe, validPrice, PRODUCT, readTextLimited, privateHeaders, methodNotAllowed, json } from '../_lib/aios.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  let origin;
  try { origin = siteOrigin(request, env); } catch { return json({ error: 'Invalid site.' }, 400); }
  const sender = request.headers.get('origin');
  if ((sender && sender !== origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Invalid request origin.' }, 403);
  try {
    const contentType = request.headers.get('content-type')?.split(';')[0];
    if (contentType !== 'application/x-www-form-urlencoded') return returnToPricing(request, env, 'error');
    const form = new URLSearchParams(await readTextLimited(request.body, 4096));
    const tier = form.get('tier');
    const config = tierConfig(tier);
    if (!config || form.getAll('tier').length !== 1) return returnToPricing(request, env, 'error');
    const priceId = env[config.priceEnv];
    // The feature gate stays off until webhook delivery and purchase QA are complete.
    if (env.AIOS_CHECKOUT_ENABLED !== 'true' || env.AIOS_EMAIL_ENABLED !== 'true' || !env.BREVO_API_KEY?.trim() || !env.STRIPE_WEBHOOK_SECRET || !env.AIOS_FILES || !/^price_[A-Za-z0-9]+$/.test(priceId || '')) {
      return returnToPricing(request, env, 'unavailable');
    }
    if (!await env.AIOS_FILES.head('files/' + FILES[config.file])) return returnToPricing(request, env, 'unavailable');
    const price = await stripe(env, '/prices/' + encodeURIComponent(priceId) + '?expand[]=product');
    if (!validPrice(price, tier, env, true)) return returnToPricing(request, env, 'unavailable');
    const fields = new URLSearchParams({
      mode: 'payment',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'adaptive_pricing[enabled]': 'false',
      success_url: origin + '/ai-agency-os/thanks?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/ai-agency-os?checkout=cancelled#pricing',
      client_reference_id: crypto.randomUUID(),
      integration_identifier: 'ai-agency-os-kmrxqvzt'
    });
    const metadata = { product: PRODUCT, tier, source_site: new URL(origin).hostname, source_page: '/ai-agency-os' };
    for (const [key, value] of Object.entries(metadata)) {
      fields.set('metadata[' + key + ']', value);
      fields.set('payment_intent_data[metadata][' + key + ']', value);
    }
    const session = await stripe(env, '/checkout/sessions', fields);
    const checkout = new URL(session.url);
    if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com' || checkout.username || checkout.password) throw new Error('invalid_checkout_url');
    return new Response(null, { status: 303, headers: { ...privateHeaders, location: checkout.href } });
  } catch {
    console.error(JSON.stringify({ event: 'aios_checkout_failed' }));
    return returnToPricing(request, env, 'error');
  }
}
