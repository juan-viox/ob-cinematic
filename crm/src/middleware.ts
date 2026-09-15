import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Same value as `BASE_PATH` in '@/lib/url' (kept inline so the edge bundle
// does not depend on app code). Raw `Location` headers must include it
// because Next only auto-prefixes NextResponse.redirect(URL) / redirect().
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Paths that never require authentication (basePath already stripped by Next) */
const publicPaths = ['/login', '/signup', '/auth/callback', '/portal-login']

const NOT_CONFIGURED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OccasionsBox CRM</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#2C3E50;line-height:1.5}</style>
</head><body>
<h1>OccasionsBox CRM is not configured yet</h1>
<p>OccasionsBox CRM is not configured yet — add the Supabase environment variables in Vercel.</p>
</body></html>`

/** Host-agnostic redirect: relative Location header including the basePath. */
function redirectTo(path: string) {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${BASE_PATH}${path}` },
  })
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // ── 0. Not configured yet (Vercel builds before env vars are pasted) ──
  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse(NOT_CONFIGURED_HTML, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '300',
      },
    })
  }

  // ── 1. Always allow public paths ──
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next({ request })
  }

  // ── 2. Always allow ingest API routes (API-key / origin auth in the handlers) ──
  if (pathname.startsWith('/api/v1/ingest')) {
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
      return redirectTo('/portal-login')
    }
    return supabaseResponse
  }

  // ── 6. All other routes: require auth ──
  if (!user) {
    return redirectTo('/login')
  }

  return supabaseResponse
}

export const config = {
  // Next prefixes each matcher with `basePath` automatically.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
