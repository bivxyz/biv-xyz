import { paidSession, TIERS, json, methodNotAllowed, downloadPath, bookingUrl } from '../_lib/aios.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  try {
    const session = await paidSession(env, new URL(request.url).searchParams.get('session_id'));
    if (!session) return json({ paid: false });
    const tier = session.metadata.tier;
    return json({ paid: true, tier, name: TIERS[tier].name, file: TIERS[tier].file,
      download: downloadPath(session), ...(tier === 'dfy' ? { booking: bookingUrl(env) } : {}) });
  } catch (error) {
    const reasons = ['invalid_mode', 'missing_stripe_key', 'invalid_stripe_key_format', 'stripe_key_environment_mismatch', 'stripe_request_failed', 'stripe_invalid_response'];
    console.error(JSON.stringify({ event: 'aios_payment_verification_failed', reason: reasons.includes(error.message) ? error.message : 'verification_failed', ...(Number.isInteger(error.status) ? { status: error.status } : {}) }));
    return json({ paid: false, error: 'Payment verification is temporarily unavailable.' }, 503);
  }
}
