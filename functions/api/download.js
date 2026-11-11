import { FILES, TIERS, paidSession, json, privateHeaders, methodNotAllowed } from '../_lib/aios.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const url = new URL(request.url);
  const file = url.searchParams.get('tier');
  if (!Object.hasOwn(FILES, file || '')) return json({ error: 'File not found.' }, 404);
  try {
    const session = await paidSession(env, url.searchParams.get('session_id'));
    if (!session || TIERS[session.metadata.tier].file !== file) return json({ error: 'Payment not confirmed.' }, 403);
    if (!env.AIOS_FILES) return json({ error: 'Download temporarily unavailable.' }, 503);
    const object = await env.AIOS_FILES.get('files/' + FILES[file]);
    if (!object) return json({ error: 'Download temporarily unavailable.' }, 503);
    return new Response(object.body, { headers: { ...privateHeaders,
      'content-type': 'application/zip', 'content-length': String(object.size),
      'content-disposition': 'attachment; filename="' + FILES[file] + '"'
    } });
  } catch { return json({ error: 'Download temporarily unavailable.' }, 503); }
}
