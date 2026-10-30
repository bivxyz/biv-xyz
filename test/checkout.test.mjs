import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { onRequest as checkout } from '../functions/api/checkout.js';
import { onRequest as sessionRoute } from '../functions/api/session.js';
import { onRequest as download } from '../functions/api/download.js';
import { onRequest as webhook } from '../functions/api/stripe-webhook.js';
import { emailPayload } from '../functions/_lib/fulfillment.js';
import { PRODUCT, TIERS, FILES, privateHeaders } from '../functions/_lib/aios.js';

const originalFetch = globalThis.fetch;
let calls, sessions, prices, store, env, failStripe, failStore, mailCalls, mailAccepted, failMailRecipient;
const ids = { playbook: 'cs_test_PLAYBOOK000001', team: 'cs_test_TEAM000000001', dfy: 'cs_test_DFY0000000001' };
function price(tier) {
  return { id: 'price_' + tier, object: 'price', active: true, type: 'one_time', currency: 'usd',
    unit_amount: TIERS[tier].cents, livemode: false, metadata: { product: PRODUCT, tier },
    product: { id: 'prod_' + tier, object: 'product', active: true, metadata: { product: PRODUCT, tier } } };
}
function paid(tier) {
  return { id: ids[tier], mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
    currency: 'usd', amount_total: TIERS[tier].cents, metadata: { product: PRODUCT, tier, source_site: 'biv.xyz' },
    line_items: { data: [{ quantity: 1, price: price(tier) }], has_more: false },
    payment_intent: { id: 'pi_' + tier, status: 'succeeded', currency: 'usd', amount_received: TIERS[tier].cents,
      metadata: { product: PRODUCT, tier }, latest_charge: { paid: true, refunded: false, amount_refunded: 0, disputed: false } },
    created: 1793280000, customer_details: { email: 'buyer@example.com' } };
}
beforeEach(() => {
  calls = []; mailCalls = []; mailAccepted = new Map(); failMailRecipient = null; failStripe = false; failStore = false;
  sessions = Object.fromEntries(Object.keys(ids).map(t => [ids[t], paid(t)]));
  prices = Object.fromEntries(Object.keys(ids).map(t => ['price_' + t, price(t)]));
  store = new Map(Object.entries(FILES).map(([tier, file]) => ['files/' + file, tier.toUpperCase() + 'ZIP']));
  env = { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: ['rk','test','fixture'].join('_'),
    STRIPE_WEBHOOK_SECRET: 'webhook-fixture', STRIPE_PRICE_PLAYBOOK: 'price_playbook',
    STRIPE_PRICE_TEAM: 'price_team', STRIPE_PRICE_DFY: 'price_dfy', AIOS_CHECKOUT_ENABLED: 'true', AIOS_EMAIL_ENABLED: 'true', BREVO_API_KEY: 'email-fixture',
    AIOS_FILES: {
      async head(key) { return store.has(key) ? {key} : null; },
      async get(key) { const value = store.get(key); return value === undefined ? null : { body: new Response(value).body, size: Buffer.byteLength(value), etag: createHash('sha256').update(value).digest('hex') }; },
      async put(key, value, options) {
        if (failStore) throw new Error('storage unavailable');
        if (options.onlyIf instanceof Headers) {
          assert.equal(options.onlyIf.get('If-None-Match'), '*');
          if (store.has(key)) return null;
        } else if (!store.has(key) || options.onlyIf.etagMatches !== createHash('sha256').update(store.get(key)).digest('hex')) return null;
        store.set(key, value); return { key, etag: createHash('sha256').update(value).digest('hex') };
      }
    }
  };
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
      const payload = JSON.parse(options.body);
      mailCalls.push(payload);
      const key = payload.headers.idempotencyKey;
      if (mailAccepted.has(key)) return Response.json({code:'duplicate_parameter',message:'Email for the idempotency key has already been processed'},{status:400});
      if (payload.tags.includes(failMailRecipient)) return Response.json({code:'server_error'},{status:503});
      const messageId = '<mail-' + mailAccepted.size + '@example.com>';
      mailAccepted.set(key, messageId);
      return Response.json({messageId},{status:201});
    }
    calls.push({ url: String(url), options });
    assert.ok(String(url).startsWith('https://api.stripe.com/v1/'));
    assert.equal(options.headers['stripe-version'], '2026-09-30.endive');
    if (failStripe) return Response.json({ error: {} }, { status: 503 });
    const path = new URL(url).pathname;
    if (options.method === 'POST') return Response.json({ id: 'cs_test_NEW0000000001', url: 'https://checkout.stripe.com/c/pay/example' });
    if (path.startsWith('/v1/prices/')) return Response.json(prices[path.split('/').at(-1)] || { error: {} });
    const value = sessions[path.split('/').at(-1)];
    return value ? Response.json(value) : Response.json({ error: {} }, { status: 404 });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });
const post = (body = 'tier=team', extra = {}) => new Request('https://biv.xyz/api/checkout', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...extra }, body
});
const get = (path) => new Request('https://biv.xyz' + path);
const view = async (id) => sessionRoute({ request: get('/api/session?session_id=' + encodeURIComponent(id)), env });
const dl = (tier, id) => download({ request: get('/api/download?tier=' + tier + '&session_id=' + encodeURIComponent(id)), env });
function event(tier = 'team', overrides = {}) {
  return JSON.stringify({ id: 'evt_fixture', type: 'checkout.session.completed', livemode: false,
    data: { object: sessions[ids[tier]] }, ...overrides });
}
function hook(body, { secret = env.STRIPE_WEBHOOK_SECRET, timestamp = Math.floor(Date.now()/1000), signature } = {}) {
  const sig = signature ?? ('t=' + timestamp + ',v1=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex'));
  return webhook({ request: new Request('https://biv.xyz/api/stripe-webhook', { method:'POST', headers:{'stripe-signature':sig}, body }), env });
}

test('all tiers use fixed server prices and put portable attribution on session and payment', async () => {
  for (const tier of Object.keys(ids)) {
    const r = await checkout({ request: post('tier=' + tier + '&amount=1&price=price_attacker'), env });
    assert.equal(r.status, 303); assert.match(r.headers.get('location'), /^https:\/\/checkout.stripe.com\//);
    const p = calls.at(-1).options.body;
    assert.equal(p.get('line_items[0][price]'), 'price_' + tier);
    assert.equal(p.get('line_items[0][quantity]'), '1');
    assert.equal(p.get('mode'), 'payment');
    assert.equal(p.get('adaptive_pricing[enabled]'), 'false');
    assert.equal(p.get('success_url'), 'https://biv.xyz/ai-agency-os/thanks?session_id={CHECKOUT_SESSION_ID}');
    assert.equal(p.get('cancel_url'), 'https://biv.xyz/ai-agency-os?checkout=cancelled#pricing');
    for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
      assert.equal(p.get(prefix + '[product]'), PRODUCT);
      assert.equal(p.get(prefix + '[tier]'), tier);
      assert.equal(p.get(prefix + '[source_site]'), 'biv.xyz');
    }
    assert.ok(!p.has('payment_method_types[]'));
    assert.match(p.get('integration_identifier'), /-[a-z]{8}$/);
  }
});
test('unknown, prototype, duplicate, malformed, oversized and cross-site submissions cannot create sessions', async () => {
  for (const body of ['tier=__proto__','tier=toString','tier=admin','tier=','tier=team&tier=dfy','tier=team&padding='+'x'.repeat(4096)]) {
    const r = await checkout({ request: post(body), env });
    assert.equal(r.status,303); assert.match(r.headers.get('location'), /checkout=error/);
  }
  assert.equal((await checkout({request:post('tier=team',{'origin':'https://evil.example'}),env})).status,403);
  assert.equal((await checkout({request:post('tier=team',{'sec-fetch-site':'cross-site'}),env})).status,403);
  assert.equal(calls.length,0);
});
test('checkout stays closed without the explicit gate, each price, webhook or storage', async () => {
  for (const field of ['AIOS_CHECKOUT_ENABLED','AIOS_EMAIL_ENABLED','BREVO_API_KEY','STRIPE_PRICE_TEAM','STRIPE_WEBHOOK_SECRET','AIOS_FILES']) {
    const r = await checkout({request:post(),env:{...env,[field]:undefined}});
    assert.match(r.headers.get('location'),/checkout=unavailable/);
  }
  assert.equal(calls.length,0);
});
test('wrong price amount, product, currency, recurring price and account mode fail closed', async () => {
  for (const change of [p=>p.unit_amount=1,p=>p.currency='eur',p=>p.type='recurring',p=>p.metadata.product='other',p=>p.product.metadata.tier='dfy',p=>p.livemode=true,p=>p.active=false]) {
    prices.price_team=price('team');change(prices.price_team);
    const r=await checkout({request:post(),env});assert.match(r.headers.get('location'),/checkout=unavailable/);
  }
  assert.ok(calls.every(c=>c.options.method==='GET'));
});
test('a new configured domain retains product identity and tracks its own source', async () => {
  env.PUBLIC_SITE_URL='https://agency.example';
  const request=new Request('https://agency.example/api/checkout',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'tier=team'});
  assert.equal((await checkout({request,env})).status,303);
  assert.equal(calls.at(-1).options.body.get('metadata[product]'),PRODUCT);
  assert.equal(calls.at(-1).options.body.get('metadata[source_site]'),'agency.example');
  assert.equal((await checkout({request:new Request('https://evil.example/api/checkout',{method:'POST'}),env})).status,400);
});
test('Stripe errors and mismatched restricted keys never expose credentials', async () => {
  failStripe=true;
  assert.match((await checkout({request:post(),env})).headers.get('location'),/checkout=error/);
  failStripe=false;env.STRIPE_SECRET_KEY=['rk','live','fixture'].join('_');
  assert.match((await checkout({request:post(),env})).headers.get('location'),/checkout=error/);
});
test('paid session responses contain only tier, entitlement and optional booking; no buyer data', async () => {
  for (const tier of Object.keys(ids)) {
    const r=await view(ids[tier]);const data=await r.json();
    assert.equal(data.paid,true);assert.equal(data.file,TIERS[tier].file);
    assert.equal(data.download,'/api/download?session_id='+ids[tier]+'&tier='+TIERS[tier].file);
    assert.equal(data.booking===undefined,tier!=='dfy');
    assert.ok(!JSON.stringify(data).includes('buyer@example.com'));
    assert.equal(r.headers.get('cache-control'),privateHeaders['cache-control']);
  }
});
test('all unpaid, incomplete, refunded, partially refunded, disputed and foreign-product sessions deny access', async () => {
  for (const change of [s=>s.payment_status='unpaid',s=>s.status='open',s=>s.metadata.product='other',s=>s.livemode=true,
    s=>s.payment_intent.latest_charge.refunded=true,s=>s.payment_intent.latest_charge.amount_refunded=1,
    s=>s.payment_intent.latest_charge.disputed=true,s=>s.payment_intent.status='processing',s=>s.amount_total=1,
    s=>s.line_items.data[0].quantity=2,s=>s.line_items.data[0].price.product.metadata.product='other']) {
    sessions[ids.team]=paid('team');change(sessions[ids.team]);
    assert.deepEqual(await (await view(ids.team)).json(),{paid:false});
    assert.equal((await dl('team',ids.team)).status,403);
  }
});
test('malformed IDs and paths fail before Stripe; missing sessions deny access', async () => {
  for(const id of ['','nope','cs_test_../../customers','cs_live_abcdefghijkl','cs_test_short'])assert.deepEqual(await (await view(id)).json(),{paid:false});
  assert.equal(calls.length,0);
  assert.deepEqual(await (await view('cs_test_NONEXISTENT0001')).json(),{paid:false});
});
test('download entitlements are Playbook→Playbook, Team→Team, Done for you→Team only', async () => {
  for(const tier of Object.keys(ids))for(const file of ['playbook','team','dfy','../orders']){
    const r=await dl(file,ids[tier]);
    const expected=!Object.hasOwn(FILES,file)?404:TIERS[tier].file===file?200:403;
    assert.equal(r.status,expected);
    if(expected===200){assert.equal(await r.text(),file.toUpperCase()+'ZIP');assert.match(r.headers.get('content-disposition'),/v0\.2\.8.zip/);assert.match(r.headers.get('cache-control'),/no-store/);}
  }
});
test('paid downloads survive price rotation and archived prices', async () => {
  env.STRIPE_PRICE_TEAM='price_new';sessions[ids.team].line_items.data[0].price.active=false;
  assert.equal((await dl('team',ids.team)).status,200);
});
test('verification and storage outages are retriable without leaking details', async () => {
  failStripe=true;assert.equal((await view(ids.team)).status,503);assert.equal((await dl('team',ids.team)).status,503);
  failStripe=false;store.clear();assert.equal((await dl('team',ids.team)).status,503);
});
test('booking accepts plain HTTPS only, otherwise uses personal outreach', async () => {
  env.BOOKING_URL='https://cal.example/kickoff';assert.equal((await (await view(ids.dfy)).json()).booking,env.BOOKING_URL);
  for(const value of ['javascript:alert(1)','http://cal.example','https://name:password@cal.example','https://cal.example/"bad']){
    env.BOOKING_URL=value;assert.equal((await (await view(ids.dfy)).json()).booking,null);
  }
});
test('signed webhook records one order even under concurrent duplicate deliveries', async () => {
  const body=event('dfy');
  const responses=await Promise.all([hook(body),hook(body),hook(body)]);
  assert.ok(responses.some(r=>r.status===200));
  assert.ok(responses.every(r=>[200,500].includes(r.status)));
  assert.equal(mailAccepted.size,2);
  const record=JSON.parse(store.get('orders/'+ids.dfy));
  assert.equal(record.product,PRODUCT);assert.equal(record.delivery_status,'submitted');assert.equal(record.email,'buyer@example.com');
});
test('invalid, stale and tampered webhook signatures fail before recording', async () => {
  const body=event();
  for(const options of [{secret:'wrong'},{timestamp:1},{signature:'t=abc,v1=00'},{signature:''}])assert.equal((await hook(body,options)).status,400);
  const r=await hook(body+' ',{signature:'t='+Math.floor(Date.now()/1000)+',v1='+createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(Math.floor(Date.now()/1000)+'.'+body).digest('hex')});
  assert.equal(r.status,400);assert.ok(!store.has('orders/'+ids.team));
});
test('async success records a payment; unrelated, unpaid, live-mode and failed events are ignored', async () => {
  for(const overrides of [{type:'payment_intent.succeeded'},{type:'checkout.session.async_payment_failed'},{livemode:true}])assert.equal((await (await hook(event('team',overrides))).json()).ignored,true);
  sessions[ids.team].payment_status='unpaid';assert.equal((await (await hook(event())).json()).ignored,true);
  sessions[ids.team]=paid('team');assert.equal((await hook(event('team',{type:'checkout.session.async_payment_succeeded'}))).status,200);
  assert.ok(store.has('orders/'+ids.team));
});
test('webhook storage failures return 500 for Stripe retry; missing settings return 503', async () => {
  failStore=true;assert.equal((await hook(event())).status,500);assert.ok(!store.has('orders/'+ids.team));
  failStore=false;assert.equal((await hook(event())).status,200);
  env.STRIPE_WEBHOOK_SECRET='';assert.equal((await hook(event())).status,503);
});
test('all routes explicitly reject unsupported methods rather than serving HTML', async () => {
  for(const [route,path,method]of [[checkout,'/api/checkout','GET'],[sessionRoute,'/api/session','POST'],[download,'/api/download','POST'],[webhook,'/api/stripe-webhook','GET']]){
    const r=await route({request:new Request('https://biv.xyz'+path,{method}),env});assert.equal(r.status,405);
  }
});

test('missing buyer ZIP prevents checkout before creating a Stripe session', async () => {
  store.delete('files/'+FILES.team);
  assert.match((await checkout({request:post(),env})).headers.get('location'),/checkout=unavailable/);
  assert.equal(calls.length,0);
});
test('malformed signed webhook payloads are rejected', async () => {
  assert.equal((await hook('null')).status,400);
  assert.equal((await hook('{')).status,400);
});

test('both supported Stripe key types work in the correct environment', async () => {
  for (const prefix of ['rk','sk']) {
    env.STRIPE_SECRET_KEY=[prefix,'test','fixture'].join('_');
    assert.equal((await checkout({request:post(),env})).status,303);
    assert.equal((await view(ids.team)).status,200);
  }
});

test('clipboard whitespace is ignored without weakening test/live separation', async () => {
  env.STRIPE_SECRET_KEY='  '+['rk','test','fixture'].join('_')+'\n';
  assert.equal((await checkout({request:post(),env})).status,303);
  env.STRIPE_SECRET_KEY='  '+['sk','live','fixture'].join('_')+'\n';
  assert.match((await checkout({request:post(),env})).headers.get('location'),/checkout=error/);
});

test('each tier emails the entitled ZIP and a private fallback page; dfy includes kickoff', async () => {
  for (const tier of Object.keys(ids)) {
    assert.equal((await hook(event(tier))).status,200);
    const buyer=mailCalls.at(-2), owner=mailCalls.at(-1);
    assert.equal(buyer.sender.email,'me@biv.xyz');
    assert.deepEqual(buyer.to,[{email:'buyer@example.com'}]);
    assert.match(buyer.subject,/^\[TEST\]/);
    assert.ok(buyer.textContent.includes(tier==='playbook'?'Download the Playbook':'Download the Team'));
    assert.ok(buyer.textContent.includes('&tier='+TIERS[tier].file));
    assert.ok(buyer.textContent.includes('/ai-agency-os/thanks?session_id='+ids[tier]));
    assert.equal(buyer.textContent.includes('kickoff'),tier==='dfy');
    assert.ok(buyer.htmlContent.includes('display:none!important'));
    assert.equal(buyer.sender.name,'Biv');
    assert.equal(owner.to[0].email,'me@biv.xyz');
    assert.ok(!owner.textContent.includes(ids[tier]));
    assert.match(buyer.headers.idempotencyKey,/^[\da-f-]{36}$/);
  }
});
test('webhook redelivery does not send another email', async () => {
  assert.equal((await hook(event())).status,200);
  for(let i=0;i<3;i++)assert.equal((await hook(event())).status,200);
  assert.equal(mailCalls.length,2);
});
test('owner email failure retries independently without resending buyer instructions', async () => {
  failMailRecipient='owner';
  assert.equal((await hook(event())).status,500);
  let record=JSON.parse(store.get('orders/'+ids.team));
  assert.equal(record.emails.buyer.state,'accepted');
  assert.equal(record.delivery_status,'pending');
  const ownerPayload=mailCalls.at(-1);
  failMailRecipient=null;
  assert.equal((await hook(event())).status,200);
  assert.deepEqual(mailCalls.at(-1),ownerPayload);
  assert.equal(mailCalls.filter(p=>p.tags.includes('buyer')).length,1);
  assert.equal(JSON.parse(store.get('orders/'+ids.team)).delivery_status,'submitted');
});
test('provider accepted but persistence failed retries using the same idempotency key', async () => {
  const fetch=globalThis.fetch;
  let once=true;
  globalThis.fetch=async(...args)=>{
    const response=await fetch(...args);
    if(String(args[0]).includes('api.brevo.com')&&once){once=false;failStore=true;}
    return response;
  };
  assert.equal((await hook(event())).status,500);
  failStore=false;
  const record=JSON.parse(store.get('orders/'+ids.team));
  record.lease_until=0;store.set('orders/'+ids.team,JSON.stringify(record));
  assert.equal((await hook(event())).status,200);
  assert.equal(mailAccepted.size,2);
  assert.equal(mailCalls[0].headers.idempotencyKey,mailCalls[1].headers.idempotencyKey);
  assert.equal(JSON.parse(store.get('orders/'+ids.team)).emails.buyer.deduplicated,true);
});
test('an ambiguous send outside provider deduplication window requires review, without another send', async () => {
  failMailRecipient='buyer';assert.equal((await hook(event())).status,500);
  const record=JSON.parse(store.get('orders/'+ids.team));
  record.emails.buyer.started_at=Date.now()-26*60*1000;
  store.set('orders/'+ids.team,JSON.stringify(record));
  failMailRecipient=null;const before=mailCalls.length;
  assert.equal((await hook(event())).status,500);
  assert.equal(mailCalls.length,before);
  assert.equal(JSON.parse(store.get('orders/'+ids.team)).delivery_status,'needs_review');
});
test('unpaid and refunded sessions never send delivery email', async () => {
  sessions[ids.team].payment_status='unpaid';assert.equal((await hook(event())).status,200);
  sessions[ids.team]=paid('team');sessions[ids.team].payment_intent.latest_charge.refunded=true;
  assert.equal((await hook(event())).status,200);assert.equal(mailCalls.length,0);
});
test('missing sending key and missing buyer email remain retriable without email or data leakage', async () => {
  delete env.BREVO_API_KEY;assert.equal((await hook(event())).status,500);
  env.BREVO_API_KEY='fixture';store.delete('orders/'+ids.team);sessions[ids.team].customer_details.email=null;
  const r=await hook(event());assert.equal(r.status,500);
  assert.equal(mailCalls.length,0);assert.ok(!(await r.text()).includes('buyer'));
});


test('v1.3 buyer subjects, HTML preheaders, and plain text use the production purchase origin', () => {
  const subjects={playbook:'your AI Agency OS playbook is here',team:'your 8 agents are ready to import',dfy:"you're in. i'll be in touch personally."};
  for(const tier of Object.keys(ids)){
    const order={...paid(tier),tier,session_id:ids[tier],origin:'https://biv.xyz',email:'buyer@example.com',livemode:true};
    const message=emailPayload(order,'buyer',env);
    assert.equal(message.subject,subjects[tier]);
    assert.equal(message.sender.name,'Biv');
    assert.ok(message.htmlContent.includes('display:none!important'));
    assert.ok(message.htmlContent.includes('https://biv.xyz/api/download?'));
    assert.ok(message.textContent.includes('https://biv.xyz/api/download?'));
    assert.ok(message.htmlContent.includes('&amp;tier='+TIERS[tier].file));
    assert.ok(!message.htmlContent.includes('pages.dev'));
    assert.ok(!message.textContent.includes('works anytime'));
    assert.match(message.textContent,/within 14 days of purchase/);
  }
});
test('personal outreach has no booking link or unapproved response-time promise', () => {
  const order={tier:'dfy',session_id:ids.dfy,origin:'https://biv.xyz',email:'buyer@example.com',livemode:true};
  for(const booking of [undefined,'','mailto:me@biv.xyz','http://cal.example','https://name:password@cal.example']){
    const message=emailPayload(order,'buyer',{...env,BOOKING_URL:booking});
    assert.match(message.textContent,/reach out to you personally/);
    assert.ok(!message.textContent.includes('Book your kickoff call:'));
    assert.ok(!message.textContent.includes('business day'));
    assert.ok(!message.htmlContent.includes('mailto:'));
  }
});
test('a valid HTTPS booking URL selects the alternate email and preserves Team entitlement', () => {
  const order={tier:'dfy',session_id:ids.dfy,origin:'https://biv.xyz',email:'buyer@example.com',livemode:true};
  const message=emailPayload(order,'buyer',{...env,BOOKING_URL:'https://calendar.example/kickoff'});
  assert.equal(message.subject,'next step: book your kickoff call');
  assert.match(message.textContent,/Book your kickoff call:\nhttps:\/\/calendar.example\/kickoff/);
  assert.ok(message.textContent.includes('&tier=team'));
  assert.ok(!message.textContent.includes('reach out to you personally'));
});
test('owner notification sender, subject, content and plain-text format stay unchanged', () => {
  const message=emailPayload({tier:'dfy',session_id:ids.dfy,origin:'https://biv.xyz',email:'buyer@example.com',amount:199900,payment_intent:'pi_fixture',livemode:false},'owner',env);
  assert.deepEqual(message.sender,{name:'AI Agency OS',email:'me@biv.xyz'});
  assert.deepEqual(message.replyTo,message.sender);
  assert.equal(message.subject,'[TEST] AI Agency OS purchase: Done for you');
  assert.equal(message.textContent,'AI Agency OS — Done for you\nBuyer: buyer@example.com\nAmount: USD 1999.00\nPayment: pi_fixture\nSource: biv.xyz\nSandbox test. No real payment collected.\nFollow up to arrange the kickoff.');
  assert.equal(message.htmlContent,undefined);
});
