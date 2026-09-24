import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { probeBlotato } from '@/lib/blotato'

/**
 * GET /api/v1/blotato/check
 *
 * Whether Blotato will actually publish, asked of Blotato rather than assumed
 * from the presence of an environment variable.
 *
 * Two things fail here and they are not the same. A missing or wrong key is
 * obvious once asked. A valid key attached to a Blotato workspace with no
 * connected Instagram is invisible until the moment a scheduled post was
 * supposed to go out and did not, which is the worst time to learn it.
 *
 * Reads only: no post, no upload, nothing published. Session gated. The API
 * key is never returned. The account list is the caller's own, so it is safe
 * to show, and `raw` is included deliberately: the exact field names Blotato
 * returns were never confirmed against a live workspace, so the first real
 * call is also how we learn the shape.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireSession()
  if (!session.ok) return session.response

  const probe = await probeBlotato()

  return NextResponse.json({ probe }, { headers: { 'Cache-Control': 'no-store' } })
}
