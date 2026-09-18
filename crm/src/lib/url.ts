/**
 * URL helpers for the CRM's basePath mount.
 *
 * The CRM is served under `/admin` (see next.config.ts). Next.js auto-prefixes
 * <Link href>, router.push(), redirect() and NextResponse.redirect(URL), but it
 * does NOT prefix plain fetch('/api/...') calls, raw `Location` headers, or
 * URLs built from window.location.origin. Use these helpers for those.
 */

/** The configured basePath ('' when the app is mounted at the root). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * Prefix a root-relative path with the basePath. Use for fetch() URLs and raw
 * Location headers. Paths that do not start with '/' are returned unchanged.
 */
export function withBasePath(path: string): string {
  if (!path.startsWith('/')) return path
  return `${BASE_PATH}${path}`
}

/**
 * Absolute public URL for browser code (e.g. Supabase emailRedirectTo):
 * `${window.location.origin}${BASE_PATH}${path}`.
 * Falls back to the basePath-prefixed relative path when `window` is unavailable.
 */
export function publicUrl(path: string): string {
  const prefixed = withBasePath(path)
  if (typeof window === 'undefined') return prefixed
  return `${window.location.origin}${prefixed}`
}
