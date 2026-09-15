import { createBrowserClient } from '@supabase/ssr'

// Placeholders keep static prerendering (and `next build` without env vars)
// from throwing. At runtime the middleware returns a 503 page before any
// route renders when the real values are missing.
const PLACEHOLDER_URL = 'https://placeholder.supabase.co'
const PLACEHOLDER_KEY = 'placeholder-anon-key'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY
  )
}
