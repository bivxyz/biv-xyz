import { readTextLimited, verifySignature, paidSession, PRODUCT, stripeMode, json, methodNotAllowed } from '../_lib/aios.js';
import { fulfillOrder } from '../_lib/fulfillment.js';

// Record payments independently of the buyer returning to the site.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  if (!env.STRIPE_WEBHOOK_SECRET || !env.AIOS_FILES) return json({ error: 'Webhook not configured.' }, 503);
  let body;
  try { body = await readTextLimited(request.body, 65536); } catch { return json({ error: 'Invalid payload.' }, 400); }
  if (!await verifySignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) return json({ error: 'Invalid signature.' }, 400);
  let event;
  try { event = JSON.parse(body); } catch { return json({ error: 'Invalid payload.' }, 400); }
  if (!event || typeof event !== 'object') return json({ error: 'Invalid payload.' }, 400);
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return json({ received: true, ignored: true });
  const object = event.data?.object;
  if (event.livemode !== (stripeMode(env) === 'live') || object?.metadata?.product !== PRODUCT || object.payment_status !== 'paid') return json({ received: true, ignored: true });
  try {
    const session = await paidSession(env, object.id);
    if (!session) return json({ received: true, ignored: true });
    const record = {
      product: PRODUCT, tier: session.metadata.tier, session_id: session.id,
      payment_intent: session.payment_intent.id, amount: session.amount_total, currency: session.currency,
      email: session.customer_details?.email || null, source_site: session.metadata.source_site || null,
      created: session.created, livemode: session.livemode, delivery_status: 'pending'
    };
    // Atomic create-once: concurrent event deliveries cannot overwrite an order.
    const saved = await env.AIOS_FILES.put('orders/' + session.id, JSON.stringify(record), {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' }
    });
    if (env.AIOS_EMAIL_ENABLED === 'true') await fulfillOrder(env, session, request);
    return json({ received: true, duplicate: saved === null });
  } catch {
    console.error(JSON.stringify({ event: 'aios_webhook_failed' }));
    return json({ error: 'Please retry delivery.' }, 500);
  }
}
