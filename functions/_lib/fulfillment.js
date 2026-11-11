import { TIERS, downloadPath, bookingUrl, readTextLimited, siteOrigin } from './aios.js';

const metadata = { contentType: 'application/json', cacheControl: 'private, no-store' };
const LEASE_MS = 120000;
// Brevo deduplicates for 30 minutes. Ambiguous older sends require reconciliation.
const RETRY_WINDOW_MS = 25 * 60 * 1000;
const SENDER = { name: 'AI Agency OS', email: 'me@biv.xyz' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buyerEmail(order, env) {
  const dl = order.origin + downloadPath({ id: order.session_id, metadata: { tier: order.tier } });
  const thanks = order.origin + '/ai-agency-os/thanks?session_id=' + encodeURIComponent(order.session_id);
  const book = bookingUrl(env);
  const booking = book !== null;
  let subject, preheader, blocks;
  if (order.tier === 'playbook') {
    subject = 'your AI Agency OS playbook is here';
    preheader = 'Every SOP, ready to paste into your AI tool.';
    blocks = [
      ['Thanks for getting The Playbook.'],
      [{ label: 'Download the Playbook', url: dl, button: true }],
      ['Start with one role, not all 8. Pick the task you repeat most, paste that SOP into your AI tool, and run it once this week.']
    ];
  } else if (order.tier === 'team') {
    subject = 'your 8 agents are ready to import';
    preheader = 'All 8 agent templates, the full playbook and the install guide.';
    blocks = [
      ['Thanks for getting The Team.'],
      [{ label: 'Download the Team', url: dl, button: true }],
      ['Inside are all 8 agent templates for Grok Bot, the full playbook and the install guide.'],
      ["Open the install guide first. Step 1 imports the templates. Step 4 connects your hosting, and it's the one that matters most, so give it a real block of time."]
    ];
  } else {
    subject = booking ? 'next step: book your kickoff call' : "you're in. i'll be in touch personally.";
    preheader = booking ? "Pick a time, and I'll set your team up for you." : "Nothing to book. I'll email you personally.";
    blocks = [
      ['Thanks for choosing Done for you.'],
      ...(booking ? [
        ['First, book your kickoff call.'],
        [{ label: 'Book your kickoff call', url: book, button: true }]
      ] : [["You don't need to book anything. I'll reach out to you personally to set up your kickoff call."]]),
      ['On the call, we go through your accounts. Then I set the team up for you.'],
      ['Done for you also includes everything in The Team, so your files are ready now.'],
      [{ label: 'Download the Team files', url: dl, button: true }]
    ];
  }
  blocks.push(
    ['Keep this email. Your link checks your order each time. If it ever breaks, use ', { label: 'this page', url: thanks }, '.'],
    ["Changed your mind? Reply within 14 days of purchase and I'll refund you."],
    ['- Biv\nme@biv.xyz']
  );
  if (!order.livemode) blocks.unshift(['This is a sandbox test purchase. No real payment was collected.']);
  const textContent = blocks.map(parts => parts.map(part => typeof part === 'string' ? part : part.label + ':\n' + part.url).join('')).join('\n\n');
  const htmlBlocks = blocks.map(parts => '<p style="margin:0 0 22px">' + parts.map(part => {
    if (typeof part === 'string') return escapeHtml(part).replace(/\n/g, '<br>');
    const style = part.button ? 'display:inline-block;padding:14px 20px;border-radius:8px;background:#f2b441;color:#151515;text-decoration:none;font-weight:600' : 'color:#805400;text-decoration:underline';
    return '<a href="' + escapeHtml(part.url) + '" style="' + style + '">' + escapeHtml(part.label) + '</a>';
  }).join('') + '</p>').join('');
  const htmlContent = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escapeHtml(subject) + '</title></head><body style="margin:0;background:#f7f4ec;color:#1f2119;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.65"><span style="display:none!important;visibility:hidden;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">' + escapeHtml(preheader) + '</span><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 20px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse"><tr><td><p style="margin:0 0 28px;font-size:12px;letter-spacing:1px;color:#805400">BIV.XYZ / AI AGENCY OS</p>' + htmlBlocks + '</td></tr></table></td></tr></table></body></html>';
  return { subject: (order.livemode ? '' : '[TEST] ') + subject, textContent, htmlContent };
}

export function emailPayload(order, recipient, env) {
  const tier = TIERS[order.tier];
  const test = order.livemode ? '' : '[TEST] ';
  const sender = recipient === 'buyer' ? { name: 'Biv', email: SENDER.email } : SENDER;
  return {
    sender, replyTo: sender,
    to: [{ email: recipient === 'buyer' ? order.email : SENDER.email }],
    ...(recipient === 'buyer' ? buyerEmail(order, env) : {
      subject: test + `AI Agency OS purchase: ${tier.name}`,
      textContent: [
        `AI Agency OS — ${tier.name}`, `Buyer: ${order.email}`,
        `Amount: USD ${(order.amount / 100).toFixed(2)}`,
        `Payment: ${order.payment_intent}`, `Source: ${order.source_site || new URL(order.origin).hostname}`,
        order.livemode ? 'Live purchase.' : 'Sandbox test. No real payment collected.',
        order.tier === 'dfy' ? 'Follow up to arrange the kickoff.' : ''
      ].filter(Boolean).join('\n')
    }),
    tags: ['ai-agency-os', order.tier, order.livemode ? 'live-purchase' : 'sandbox-test', recipient]
  };
}

async function sendEmail(env, payload, idempotencyKey) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY.trim(), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ ...payload, headers: { idempotencyKey } }),
    signal: AbortSignal.timeout(12000)
  });
  const raw = await readTextLimited(response.body, 65536);
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('email_ambiguous_response'); }
  if (response.ok && typeof data.messageId === 'string') return { message_id: data.messageId };
  if (response.status === 400 && data.code === 'duplicate_parameter' && /idempotency/i.test(data.message || '')) {
    return { deduplicated: true };
  }
  throw new Error('email_request_failed');
}

export async function fulfillOrder(env, session, request) {
  if (!env.BREVO_API_KEY?.trim()) throw new Error('email_not_configured');
  const key = 'orders/' + session.id;
  const existing = await env.AIOS_FILES.get(key);
  if (!existing) throw new Error('missing_order');
  const order = JSON.parse(await readTextLimited(existing.body, 65536));
  if (order.delivery_status === 'submitted') return { duplicate: true };
  if (!order.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(order.email)) throw new Error('missing_buyer_email');
  if (order.lease_until > Date.now()) throw new Error('delivery_in_progress');
  order.origin ||= siteOrigin(request, env);
  order.emails ||= {};
  order.lease_until = Date.now() + LEASE_MS;
  let saved = await env.AIOS_FILES.put(key, JSON.stringify(order), {
    onlyIf: { etagMatches: existing.etag }, httpMetadata: metadata
  });
  if (!saved) throw new Error('delivery_in_progress');
  let etag = saved.etag;
  async function persist() {
    saved = await env.AIOS_FILES.put(key, JSON.stringify(order), { onlyIf: { etagMatches: etag }, httpMetadata: metadata });
    if (!saved) throw new Error('delivery_lock_lost');
    etag = saved.etag;
  }
  try {
    for (const recipient of ['buyer', 'owner']) {
      let message = order.emails[recipient];
      if (message?.state === 'accepted') continue;
      if (message?.started_at && Date.now() - message.started_at > RETRY_WINDOW_MS) {
        order.delivery_status = 'needs_review';
        throw new Error('email_reconciliation_required');
      }
      if (!message) {
        message = order.emails[recipient] = {
          state: 'sending', started_at: Date.now(), idempotency_key: crypto.randomUUID(),
          // Persist the exact request so retries do not change with configuration.
          payload: emailPayload(order, recipient, env)
        };
        await persist();
      }
      const accepted = await sendEmail(env, message.payload, message.idempotency_key);
      Object.assign(message, accepted, { state: 'accepted', accepted_at: Date.now() });
      await persist();
    }
    // Submitted means Brevo accepted both messages; it does not assert inbox delivery.
    order.delivery_status = 'submitted';
    order.lease_until = 0;
    await persist();
    return { duplicate: false };
  } catch (error) {
    order.lease_until = 0;
    await persist();
    throw error;
  }
}
