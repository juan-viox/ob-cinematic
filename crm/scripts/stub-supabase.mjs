#!/usr/bin/env node
/**
 * A stand-in for Supabase, so the smoke test can render a signed-in page.
 *
 * The routes that broke in production are all behind the auth check: the
 * middleware sends a visitor without a session to the login screen, and the
 * login screen does not render the app shell, so it never calls useTheme.
 * That is why the first version of the smoke test passed against a build with
 * the provider bug still in it.
 *
 * Supabase itself is unreachable from this sandbox, and a real session would
 * need it. This answers the two calls the middleware and the pages actually
 * make: GET /auth/v1/user, which decides whether there is a session, and the
 * PostgREST reads, which return empty collections. That is enough for the
 * shell to render, which is all this test is asking about.
 *
 * It is a test fixture. It holds no secrets and is never reachable from a
 * deployment.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT || 54321);

export const STUB_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'smoke@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  phone: '',
  confirmed_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Smoke Test' },
  identities: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_anonymous: false,
};

const send = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Range': '0-0/0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(text);
};

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') return send(res, 200, {});

  if (pathname === '/auth/v1/user') return send(res, 200, STUB_USER);

  if (pathname.startsWith('/auth/v1/token')) {
    return send(res, 200, {
      access_token: process.env.STUB_ACCESS_TOKEN || 'stub',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'stub-refresh',
      user: STUB_USER,
    });
  }

  if (pathname.startsWith('/auth/v1/logout')) return send(res, 204, {});

  /* Every table reads as empty. A page that cannot cope with no rows is a
     real fault worth catching here, not something to paper over. */
  if (pathname.startsWith('/rest/v1/')) return send(res, 200, []);

  return send(res, 200, {});
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub supabase listening on http://127.0.0.1:${PORT}`);
});
