/**
 * biv.xyz - newsletter opt-in. Cloudflare Pages Function, POST /api/subscribe
 *
 * Drop-in for any site: change the four constants below, point the form at
 * /api/subscribe, set BREVO_API_KEY as an encrypted Pages env var.
 *
 * Why double opt-in: everything here shares one Brevo account on a shared
 * sending IP. A list per site silos the sending, SITE silos the reporting, but
 * neither protects the account - one dirty list gets every site throttled. DOI
 * is the protection. A scraped or bot-injected address never confirms, so it
 * never lands in the list at all.
 */

const LIST_ID     = 7;                             // brevo list id for this site
const TEMPLATE_ID = 8;                             // brevo double opt-in template id
const SITE        = 'biv.xyz';
const REDIRECT    = 'https://biv.xyz/subscribed';

const DOI_ENDPOINT = 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation';
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]{2,}$/;
const DOWN = 'signup is down... try again in a minute.';

export async function onRequest(context) {
  /* without this, a GET falls through to the static handler and serves the homepage. */
  if (context.request.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405, { allow: 'POST' });
  }
  return subscribe(context);
}

async function subscribe({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  /* honeypot. bots get a clean success and no api call. */
  if (String(form.get('company') || '').trim()) return json({ ok: true });

  const email = String(form.get('EMAIL') || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "that address doesn't look right." }, 400);
  }

  if (!env.BREVO_API_KEY) {
    console.error('subscribe: BREVO_API_KEY is not set');
    return json({ ok: false, error: DOWN }, 500);
  }

  const payload = {
    email,
    includeListIds: [LIST_ID],
    templateId: TEMPLATE_ID,
    redirectionUrl: REDIRECT,
    attributes: {
      SITE,
      SOURCE_URL: request.headers.get('referer') || 'https://' + SITE + '/',
      OPTIN_TS: new Date().toISOString(),
      OPTIN_IP: request.headers.get('CF-Connecting-IP') || ''
    }
  };

  let res;
  try {
    res = await fetch(DOI_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('subscribe: brevo unreachable', err);
    return json({ ok: false, error: DOWN }, 502);
  }

  if (res.ok) return json({ ok: true });

  /* never echo brevo's body to the client - it leaks list ids and account detail. */
  const detail = await res.text().catch(() => '');
  console.error('subscribe: brevo', res.status, detail);

  /* already subscribed is not an error the reader should ever see. */
  if (res.status === 400 && /duplicate_parameter|already/i.test(detail)) {
    return json({ ok: true });
  }

  return json({ ok: false, error: DOWN }, 502);
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      extra
    )
  });
}
