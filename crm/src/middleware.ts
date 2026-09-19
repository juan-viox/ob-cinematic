import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Same value as `BASE_PATH` in '@/lib/url' (kept inline so the edge bundle
// does not depend on app code). Raw `Location` headers must include it
// because Next only auto-prefixes NextResponse.redirect(URL) / redirect().
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Paths that never require authentication (basePath already stripped by Next) */
const publicPaths = ['/login', '/signup', '/auth/callback', '/portal-login', '/p']

/**
 * API prefixes that authenticate themselves in the handler (site API key,
 * Origin allowlist, ElevenLabs signature, or a proposal's public token)
 * instead of with a session cookie.
 */
const selfAuthenticatedApi = ['/api/v1/ingest', '/api/v1/agent', '/api/v1/elevenlabs', '/api/v1/public']

/**
 * Names the variables that are actually missing rather than a fixed list, so
 * nobody is sent to add something that is already set. The service role key is
 * reported alongside them even though it does not gate this page: without it
 * the CRM loads and then fails every write, which is a worse thing to discover
 * later than a page that says so now.
 */
function notConfiguredHtml(missing: string[]) {
  const items = missing.map((name) => `<li><code>${name}</code></li>`).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OccasionsBox CRM</title>
<meta name="robots" content="noindex">
<style>
body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#2C3E50;line-height:1.6}
h1{font-size:1.5rem;margin:0 0 .75rem}
code{background:#F4F1EA;padding:.1rem .35rem;border-radius:3px;font-size:.95em}
ul{padding-left:1.25rem}
li{margin:.35rem 0}
p.note{color:#6b7280;font-size:.925rem}
</style>
</head><body>
<h1>The CRM has no database connection yet</h1>
<p>Set ${missing.length === 1 ? 'this' : 'these'} on the <code>ob-crm</code> project in
Vercel, under Settings, Environment Variables, then redeploy:</p>
<ul>
${items}
</ul>
<p class="note">Both values are in Supabase under Settings, API. The anon key is the
one marked <code>public</code>; the service role key is the secret one on the same
page and it must never go in the repository.</p>
</body></html>`
}

/**
 * Redirect to a path inside the CRM.
 *
 * This used to hand-build the response with a relative Location header, to
 * dodge the basePath being applied twice. Next parses that header with
 * `new URL(value)`, which has no base to resolve against, so every redirect
 * threw ERR_INVALID_URL and took the whole middleware with it: an
 * unauthenticated visit to any page answered 500
 * MIDDLEWARE_INVOCATION_FAILED instead of showing the login screen.
 *
 * An absolute URL built from the request origin is what Next expects. The
 * basePath is applied here rather than by Next, because NextResponse.redirect
 * uses the URL exactly as given.
 */
function redirectTo(request: NextRequest, path: string) {
  const url = new URL(`${BASE_PATH}${path}`, request.nextUrl.origin)
  return NextResponse.redirect(url, 307)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // ── 0. Not configured yet (Vercel builds before env vars are pasted) ──
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [
      !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
      !supabaseAnonKey && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter((name): name is string => typeof name === 'string')

    return new NextResponse(notConfiguredHtml(missing), {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '300',
      },
    })
  }

  // ── 0b. The old /admin/api/* URLs keep answering ──
  // The CRM lived under /admin until September 2026, and Olivia's ElevenLabs
  // tools still carry that prefix in their webhook URLs. Their configs hold a
  // literal API key, so they are not something to rewrite from a chat session;
  // the prefix is dropped here instead, before any auth logic, and the request
  // continues as a plain API call. Pages under /admin get no such treatment:
  // occasionsbox.com/admin already redirects to this host.
  if (pathname.startsWith('/admin/api/')) {
    const url = request.nextUrl.clone()
    url.pathname = pathname.slice('/admin'.length)
    return NextResponse.rewrite(url)
  }

  // ── 1. Always allow public paths ──
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next({ request })
  }

  // ── 2. Always allow the self-authenticating API routes ──
  if (selfAuthenticatedApi.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  // ── 3. Create Supabase client that handles cookie refresh ──
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  let user: { id: string } | null = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
  }

  // ── 4. Every other API route requires a session (JSON 401, never a redirect) ──
  if (pathname.startsWith('/api/')) {
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return supabaseResponse
  }

  // ── 5. Portal routes: require auth, redirect to portal-login ──
  if (pathname.startsWith('/portal')) {
    if (!user) {
      return redirectTo(request, '/portal-login')
    }
    return supabaseResponse
  }

  // ── 6. All other routes: require auth ──
  if (!user) {
    return redirectTo(request, '/login')
  }

  return supabaseResponse
}

export const config = {
  // Next prefixes each matcher with `basePath` automatically.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
