// Shared, server-only AI Agency OS configuration. Never export onRequest here.
export const PRODUCT = 'ai-agency-os';
export const STRIPE_VERSION = '2026-09-30.endive';
export const TIERS = Object.freeze({
  playbook: Object.freeze({ name: 'The Playbook', cents: 7900, priceEnv: 'STRIPE_PRICE_PLAYBOOK', file: 'playbook' }),
  team: Object.freeze({ name: 'The Team', cents: 19900, priceEnv: 'STRIPE_PRICE_TEAM', file: 'team' }),
  dfy: Object.freeze({ name: 'Done for you', cents: 199900, priceEnv: 'STRIPE_PRICE_DFY', file: 'team' })
});
export const FILES = Object.freeze({
  playbook: 'AI-Agency-OS-Playbook-v0.2.8.zip',
  team: 'AI-Agency-OS-Team-v0.2.8.zip'
});
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{12,200}$/;
export const privateHeaders = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow'
};
export function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { ...privateHeaders, ...extra } });
}
export function methodNotAllowed(allow) {
  return json({ error: 'Method not allowed.' }, 405, { allow });
}
export function tierConfig(tier) {
  return typeof tier === 'string' && Object.hasOwn(TIERS, tier) ? TIERS[tier] : null;
}
export function stripeMode(env) {
  const mode = env.STRIPE_MODE || 'test';
  if (mode !== 'test' && mode !== 'live') throw new Error('invalid_mode');
  return mode;
}
function stripeKey(env) {
  const value = env.STRIPE_SECRET_KEY;
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) throw new Error('missing_stripe_key');
  const format = /^(rk|sk)_(test|live)_/.exec(key);
  if (!format) throw new Error('invalid_stripe_key_format');
  if (format[2] !== stripeMode(env)) throw new Error('stripe_key_environment_mismatch');
  return key;
}

export function siteOrigin(request, env) {
  const origin = new URL(request.url).origin;
  const url = new URL(origin);
  const local = stripeMode(env) === 'test' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const known = url.hostname === 'biv.xyz' || url.hostname === 'bivxyz.pages.dev' || url.hostname.endsWith('.bivxyz.pages.dev');
  if (env.PUBLIC_SITE_URL) {
    const configured = new URL(env.PUBLIC_SITE_URL);
    if (configured.protocol !== 'https:' || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) {
      throw new Error('invalid_site_url');
    }
    if (origin === configured.origin) return origin;
  }
  if ((known && url.protocol === 'https:') || local) return origin;
  throw new Error('untrusted_origin');
}
export function returnToPricing(request, env, state) {
  return new Response(null, { status: 303, headers: {
    ...privateHeaders,
    location: siteOrigin(request, env) + '/ai-agency-os?checkout=' + state + '#pricing'
  } });
}
export async function readTextLimited(stream, limit) {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('body_too_large'); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
export async function stripe(env, path, body) {
  const headers = { authorization: 'Bearer ' + stripeKey(env), 'stripe-version': STRIPE_VERSION };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const response = await fetch('https://api.stripe.com/v1' + path, {
    method: body ? 'POST' : 'GET', headers, body,
    signal: AbortSignal.timeout(12000)
  });
  const text = await readTextLimited(response.body, 512 * 1024);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('stripe_invalid_response'); }
  if (!response.ok) {
    const error = new Error('stripe_request_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}
export function validPrice(price, tier, env, forSale = false) {
  const config = tierConfig(tier);
  const product = price?.product;
  return !!(config && price?.object === 'price' && price.type === 'one_time' &&
    price.currency === 'usd' && price.unit_amount === config.cents &&
    price.livemode === (stripeMode(env) === 'live') &&
    price.metadata?.product === PRODUCT && price.metadata?.tier === tier &&
    product?.object === 'product' && product.metadata?.product === PRODUCT && product.metadata?.tier === tier &&
    (!forSale || (price.active && product.active)));
}
export function bookingUrl(env) {
  const fallback = null;
  if (!env.BOOKING_URL || /[\s<>"']/.test(env.BOOKING_URL)) return fallback;
  try {
    const url = new URL(env.BOOKING_URL);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : fallback;
  } catch { return fallback; }
}
// Always read Stripe afresh. Session IDs are bearer credentials, never cached or logged.
export async function paidSession(env, id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id) || !id.startsWith('cs_' + stripeMode(env) + '_')) return null;
  let session;
  try {
    session = await stripe(env, '/checkout/sessions/' + encodeURIComponent(id) +
      '?expand[]=payment_intent.latest_charge&expand[]=line_items.data.price.product');
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
  const tier = session.metadata?.tier;
  const config = tierConfig(tier);
  const intent = session.payment_intent;
  const charge = intent?.latest_charge;
  const lines = session.line_items?.data;
  if (!config || session.id !== id || session.mode !== 'payment' || session.status !== 'complete' ||
      session.payment_status !== 'paid' || session.livemode !== (stripeMode(env) === 'live') ||
      session.metadata.product !== PRODUCT || session.currency !== 'usd' || session.amount_total !== config.cents ||
      !Array.isArray(lines) || lines.length !== 1 || session.line_items.has_more || lines[0].quantity !== 1 ||
      !validPrice(lines[0].price, tier, env) ||
      intent?.status !== 'succeeded' || intent.amount_received !== config.cents || intent.currency !== 'usd' ||
      intent.metadata?.product !== PRODUCT || intent.metadata?.tier !== tier ||
      !charge || !charge.paid || charge.refunded || charge.amount_refunded > 0 || charge.disputed) return null;
  return session;
}
export function downloadPath(session) {
  return '/api/download?session_id=' + encodeURIComponent(session.id) + '&tier=' + TIERS[session.metadata.tier].file;
}
export async function verifySignature(body, header, secret) {
  if (!secret || !header || header.length > 2048) return false;
  const parts = header.split(',').map(s => s.trim());
  const times = parts.filter(s => s.startsWith('t='));
  if (times.length !== 1 || !/^t=\d+$/.test(times[0])) return false;
  const timestamp = Number(times[0].slice(2));
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(timestamp + '.' + body);
  for (const part of parts) {
    if (!/^v1=[a-fA-F0-9]{64}$/.test(part)) continue;
    const signature = Uint8Array.from(part.slice(3).match(/../g), x => parseInt(x, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, signed)) return true;
  }
  return false;
}
