#!/usr/bin/env node
/**
 * Load the CRM in a real browser and walk its routes.
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
 * finds them. Run this before pushing anything that touches middleware, the
 * layout, or a provider:
 *
 *   npx next build && node scripts/smoke-routes.mjs
 *
 * It expects a server already running on PORT (default 3100), or starts one.
 * Supabase does not need to be reachable: an unauthenticated visit must
 * redirect before any data is fetched, which is the point.
 */

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3100';
const PREFIX = '/admin';

/** Every page a signed-out visitor might land on, by link or by bookmark. */
const GUARDED = [
  '', '/dashboard', '/orders', '/catalogue', '/occasions', '/proposals',
  '/outreach', '/settings', '/contacts', '/companies', '/deals', '/invoices',
  '/reports', '/tasks', '/leads', '/activities', '/emails', '/products',
  '/calendar', '/automations', '/sites',
];

/** Pages that must render for a signed-out visitor, not redirect. */
const PUBLIC = ['/login', '/signup'];

const out = [];
let failed = 0;
const check = (ok, msg) => { out.push((ok ? 'PASS  ' : 'FAIL  ') + msg); if (!ok) failed++; };

const res = await Promise.all(GUARDED.map(async (path) => {
  const url = `${BASE}${PREFIX}${path}`;
  const r = await fetch(url, { redirect: 'manual' });
  return { path: PREFIX + (path || '/'), status: r.status, location: r.headers.get('location') };
}));

for (const r of res) {
  check(r.status === 307 || r.status === 302,
    `${r.path} redirects rather than erroring (${r.status})`);
  check((r.location || '').endsWith(`${PREFIX}/login`),
    `${r.path} sends a signed-out visitor to the login page (${r.location || 'no Location'})`);
}

for (const path of PUBLIC) {
  const r = await fetch(`${BASE}${PREFIX}${path}`);
  check(r.status === 200, `${PREFIX}${path} is reachable without a session (${r.status})`);
}

/* A browser, because the provider bug only appears once React renders.
   Playwright is not a dependency of this package, so the pass is skipped
   where it is absent. The checks above already cover the middleware, and
   they are the ones that caught the 500. */
let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('playwright not installed; skipping the browser pass.');
}

if (chromium) {
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}${PREFIX}/login`, { waitUntil: 'networkidle' });
check(await page.locator('input#email').isVisible(), 'the login form renders');
check(await page.locator('input#password').isVisible(), 'the password field renders');
check(!consoleErrors.some((e) => /ThemeProvider|useTheme/.test(e)),
  'no theme provider error in the console');
check(!(await page.locator('text=Application error').count()),
  'no React error boundary on the login page');

await browser.close();
}

console.log(out.join('\n'));
console.log(failed ? `\n${failed} FAILED` : `\nAll ${out.length} checks passed.`);
process.exit(failed ? 1 : 0);
