#!/usr/bin/env node
/**
 * Load the CRM in a real browser and walk its routes, signed out and signed in.
 *
 * This exists because two bugs shipped that `tsc --noEmit` and `next build`
 * both pass cleanly:
 *
 *   - middleware built a redirect with a relative Location header, which Next
 *     parses with `new URL(value)`. No base, so it threw, and every
 *     unauthenticated page answered 500 MIDDLEWARE_INVOCATION_FAILED instead
 *     of showing the login screen.
 *   - ThemeProvider returned its children without the context until it had
 *     mounted, so useTheme threw during server render and killed /dashboard.
 *
 * Neither is a type error and neither fails a build. Only rendering the page
 * finds them.
 *
 * The signed-in pass is not optional decoration. The first version of this
 * file only ever loaded /login, and /login does not render the app shell, so
 * it does not call useTheme: that version passed against a build with the
 * provider bug still in it. Every route the provider bug actually killed sits
 * behind the auth check, so the test has to get past it.
 *
 * Supabase is unreachable from this sandbox, so scripts/stub-supabase.mjs
 * answers in its place and a crafted session cookie gets us through the
 * middleware. Run it like this:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=smoke SUPABASE_SERVICE_ROLE_KEY=smoke \
 *   npx next build && npx next start -p 3100 &
 *   node scripts/smoke-routes.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3100';
/** The CRM's basePath: empty now that it lives at the root of
    crm.occasionsbox.com. Override with SMOKE_PREFIX if a prefix returns. */
const PREFIX = process.env.SMOKE_PREFIX ?? '';
const STUB_PORT = Number(process.env.STUB_PORT || 54321);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every page a signed-out visitor might land on, by link or by bookmark. */
const GUARDED = [
  '', '/dashboard', '/orders', '/catalogue', '/occasions', '/proposals',
  '/outreach', '/olivia', '/settings', '/contacts', '/companies', '/deals', '/invoices',
  '/reports', '/tasks', '/leads', '/activities', '/emails', '/products',
  '/calendar', '/automations', '/sites',
];

/** Pages that must render for a signed-out visitor, not redirect. */
const PUBLIC = ['/login', '/signup'];

/** The handful worth the cost of a full browser render while signed in. */
const AUTHED_IN_BROWSER = ['/dashboard', '/orders', '/catalogue', '/settings', '/olivia'];

/* Each section registers itself as it runs. A section that quietly does not
   run is the failure mode that hid the missing browser pass, so silence is
   reported as a failure rather than as a smaller total. */
const DECLARED = ['signed-out routes', 'public routes', 'signed-out browser',
                  'signed-in routes', 'signed-in browser'];
const ran = new Set();
const section = (name) => ran.add(name);

const out = [];
let failed = 0;
const check = (ok, msg) => { out.push((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) failed++; };

// ── Signed out ────────────────────────────────────────────────────────────
section('signed-out routes');
const res = await Promise.all(GUARDED.map(async (p) => {
  const r = await fetch(`${BASE}${PREFIX}${p}`, { redirect: 'manual' });
  return { path: PREFIX + (p || '/'), status: r.status, location: r.headers.get('location') };
}));

for (const r of res) {
  check(r.status === 307 || r.status === 302,
    `${r.path} redirects rather than erroring (${r.status})`);
  check((r.location || '').endsWith(`${PREFIX}/login`),
    `${r.path} sends a signed-out visitor to the login page (${r.location || 'no Location'})`);
}

section('public routes');
for (const p of PUBLIC) {
  const r = await fetch(`${BASE}${PREFIX}${p}`);
  check(r.status === 200, `${PREFIX}${p} is reachable without a session (${r.status})`);
}

/* The legacy /admin/api/* prefix must reach the same route as /api/*: Olivia's
   ElevenLabs tools still call it. Both should answer the same validation error
   for an empty body from an allowed origin, and neither should 404 or bounce
   to the login page. */
{
  const opts = { method: 'POST', redirect: 'manual',
    headers: { origin: 'https://occasionsbox.com', 'content-type': 'application/json' }, body: '{}' };
  const direct = await fetch(`${BASE}/api/v1/ingest/order`, opts);
  const legacy = await fetch(`${BASE}/admin/api/v1/ingest/order`, opts);
  check(direct.status === 400, `/api/v1/ingest/order validates an empty body (${direct.status})`);
  check(legacy.status === 400, `/admin/api/v1/ingest/order still reaches the ingest route (${legacy.status})`);
}

/* Document numbers come from server-side counters behind a session. Signed
   out, the routes must refuse with a JSON 401 rather than 404 or redirect. */
for (const p of ['/api/v1/invoices/number', '/api/v1/proposals/number']) {
  const r = await fetch(`${BASE}${p}`, { method: 'POST', redirect: 'manual' });
  check(r.status === 401, `${p} refuses a signed-out caller with 401 (${r.status})`);
}

/* Stripe: the checkout route validates the cart before it looks for keys, so
   an empty body is a 400 wherever it runs; the webhook refuses everything
   without its signing secret (503) or with a bad signature (400). Neither
   may 401 or bounce to the login page. */
{
  const checkout = await fetch(`${BASE}/api/v1/checkout/stripe`, { method: 'POST', redirect: 'manual',
    headers: { origin: 'https://occasionsbox.com', 'content-type': 'application/json' }, body: '{}' });
  check(checkout.status === 400, `/api/v1/checkout/stripe validates an empty cart (${checkout.status})`);
  const hook = await fetch(`${BASE}/api/v1/webhooks/stripe`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json' }, body: '{}' });
  check(hook.status === 503 || hook.status === 400,
    `/api/v1/webhooks/stripe refuses an unsigned event (${hook.status})`);
}

/* The ElevenLabs sync runs on a schedule and can be triggered by hand with
   the site key. Unauthorised, it must refuse with a JSON 401 rather than
   bounce to the login page or 404. */
{
  const cron = await fetch(`${BASE}/api/v1/cron/elevenlabs`, { redirect: 'manual' });
  check(cron.status === 401, `/api/v1/cron/elevenlabs refuses an unauthorised caller (${cron.status})`);
}

/* Texting. The inbound Twilio webhook must refuse anything it cannot prove
   came from Twilio: 503 with no credentials configured, 403 for a bad
   signature. The order routes that text a customer are session-only and must
   answer a JSON 401 rather than bounce to the login page. */
{
  const hook = await fetch(`${BASE}/api/v1/webhooks/twilio/sms`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'From=%2B15551234567&Body=STOP' });
  check(hook.status === 503 || hook.status === 403,
    `/api/v1/webhooks/twilio/sms refuses an unsigned delivery (${hook.status})`);

  const id = '00000000-0000-4000-8000-000000000123';
  for (const path of [`/api/v1/orders/${id}/status`, `/api/v1/orders/${id}/sms`]) {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    check(r.status === 401, `${path} refuses a signed-out caller with 401 (${r.status})`);
  }
}

// ── Playwright ────────────────────────────────────────────────────────────
/* Playwright is not a dependency of this package; it is installed globally in
   this environment, and a bare specifier does not resolve from here. The first
   version of this file treated that as a reason to skip quietly, so it printed
   a clean pass while four checks had never run. A browser that cannot be
   loaded is a failure. Set SMOKE_ALLOW_NO_BROWSER=1 where there is none. */
const CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  'playwright',
  '/opt/node22/lib/node_modules/playwright/index.mjs',
].filter(Boolean);

let chromium = null;
let loadError = null;
for (const spec of CANDIDATES) {
  try { ({ chromium } = await import(spec)); break; } catch (err) { loadError = err; }
}

if (!chromium) {
  const why = `playwright could not be loaded (${loadError?.code || loadError}); tried ${CANDIDATES.join(', ')}`;
  if (process.env.SMOKE_ALLOW_NO_BROWSER === '1') {
    out.push('SKIP  ' + why);
    for (const s of ['signed-out browser', 'signed-in browser']) section(s);
  } else {
    check(false, why);
  }
}

/** Errors that say the page itself fell over, rather than data being absent. */
const isRenderError = (t) =>
  /ThemeProvider|useTheme|Minified React error|Hydration failed|Application error/i.test(t);

let browser = null;
if (chromium) {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
  });

  section('signed-out browser');
  const page = await browser.newPage();
  const signedOutErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') signedOutErrors.push(m.text()); });
  page.on('pageerror', (e) => signedOutErrors.push(String(e)));

  await page.goto(`${BASE}${PREFIX}/login`, { waitUntil: 'networkidle' });
  check(await page.locator('input#email').isVisible(), 'the login form renders');
  check(await page.locator('input#password').isVisible(), 'the password field renders');
  check(!signedOutErrors.some(isRenderError),
    `no render error on the login page (${signedOutErrors.filter(isRenderError)[0] || 'none'})`);
  check(!(await page.locator('text=Application error').count()),
    'no React error boundary on the login page');
  await page.close();
}

// ── Signed in ─────────────────────────────────────────────────────────────
/* The middleware only asks Supabase who the visitor is. Point it at the stub
   and hand it a session cookie, and the real shell renders: the same server
   render that answered 500 in production. */
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const EXP = 4102444800; // year 2100, so the client never tries to refresh
const USER_ID = '00000000-0000-4000-8000-000000000001';
const accessToken = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp: EXP }),
  'stubsignature',
].join('.');
const sessionCookie = 'base64-' + Buffer.from(JSON.stringify({
  access_token: accessToken,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: EXP,
  refresh_token: 'stub-refresh',
  user: { id: USER_ID, email: 'smoke@example.test', aud: 'authenticated', role: 'authenticated' },
})).toString('base64url');
const COOKIE_NAME = process.env.SMOKE_COOKIE_NAME || 'sb-127-auth-token';

/* The stub has to be up before the app is asked to render a signed-in page,
   because the middleware calls it on every one of them. */
let stub = null;
const stubAlive = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${STUB_PORT}/auth/v1/user`);
    return r.ok;
  } catch { return false; }
};

if (!(await stubAlive())) {
  stub = spawn(process.execPath, [path.join(HERE, 'stub-supabase.mjs')], {
    stdio: 'ignore', env: { ...process.env, STUB_PORT: String(STUB_PORT) },
  });
  for (let i = 0; i < 50 && !(await stubAlive()); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const stubUp = await stubAlive();
check(stubUp, `the stub Supabase is answering on port ${STUB_PORT}`);

if (stubUp) {
  section('signed-in routes');
  const cookieHeader = `${COOKIE_NAME}=${sessionCookie}`;
  const authed = await Promise.all(GUARDED.map(async (p) => {
    const r = await fetch(`${BASE}${PREFIX}${p}`, {
      redirect: 'manual', headers: { cookie: cookieHeader },
    });
    return { path: PREFIX + (p || '/'), status: r.status };
  }));

  for (const r of authed) {
    check(r.status === 200 || r.status === 307,
      `${r.path} does not error for a signed-in visitor (${r.status})`);
  }

  const reached = authed.filter((r) => r.status === 200).length;
  check(reached > 0,
    `the signed-in pass got past the auth check on at least one page (${reached} of ${authed.length} returned 200). ` +
    'Zero means the app was not built against the stub; see the header of this file.');

  if (browser) {
    section('signed-in browser');
    const ctx = await browser.newContext();
    await ctx.addCookies([{
      name: COOKIE_NAME, value: sessionCookie,
      domain: '127.0.0.1', path: '/', httpOnly: false, secure: false,
    }]);

    for (const p of AUTHED_IN_BROWSER) {
      const pg = await ctx.newPage();
      const errors = [];
      pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      pg.on('pageerror', (e) => errors.push(String(e)));

      const resp = await pg.goto(`${BASE}${PREFIX}${p}`, { waitUntil: 'domcontentloaded' });
      check(resp?.status() === 200, `${PREFIX}${p} renders for a signed-in visitor (${resp?.status()})`);
      check(!errors.some(isRenderError),
        `${PREFIX}${p} renders without a provider or React crash (${errors.filter(isRenderError)[0] || 'none'})`);
      check(!(await pg.locator('text=Application error').count()),
        `${PREFIX}${p} shows no React error boundary`);
      await pg.close();
    }
    await ctx.close();
  }
}

if (browser) await browser.close();
if (stub) stub.kill();

for (const name of DECLARED) {
  if (!ran.has(name)) { out.push(`FAIL  the "${name}" section never ran`); failed++; }
}

console.log(out.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nAll ${out.length} checks passed.`);
process.exit(failed ? 1 : 0);
