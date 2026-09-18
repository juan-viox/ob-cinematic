import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { BASE_PATH } from '@/lib/url'

/**
 * Host-agnostic redirect. The same deployment is reached via two hosts
 * (ob-crm-vio-x-bergsify.vercel.app and occasionsbox.com through a rewrite),
 * so we never build the Location from request.url. A raw Location header is
 * not auto-prefixed by Next, so BASE_PATH is included manually.
 */
function relativeRedirect(path: string) {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${BASE_PATH}${path}` },
  })
}

/**
 * Only allow same-app, root-relative `next` targets. Rejects protocol-relative
 * URLs (`//host`), backslashes (browsers treat `/\host` as `//host`) and
 * CR/LF (header injection). The value is also decoded once and re-checked so
 * `%2F%2Fevil.com` / `%5C` cannot slip through.
 */
function isSafePath(value: string): boolean {
  return /^\/(?![\/\\])/.test(value) && !/[\\\r\n]/.test(value)
}

function safeNext(value: string | null): string {
  if (!value || !isSafePath(value)) return '/dashboard'
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return '/dashboard'
  }
  if (!isSafePath(decoded)) return '/dashboard'
  return value
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (code && supabaseUrl && supabaseAnonKey) {
    const cookieStore = await cookies()
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    })

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return relativeRedirect(next)
    }
  }

  return relativeRedirect('/login?error=auth_callback_error')
}
