import { NextResponse } from 'next/server'
import { getIngestClient, getOrgId, safeEqualStrings } from '@/lib/ingest'
import { syncConversations } from '@/lib/elevenlabs-sync'

/**
 * GET /api/v1/cron/elevenlabs
 *
 * Pulls Olivia's recent conversations from ElevenLabs and files any the CRM
 * has not seen, emailing the team about the recent ones. Vercel runs it on
 * the schedule in vercel.json; it can also be triggered by hand with the
 * site API key, which is how it gets verified after a deploy.
 *
 * Why a schedule rather than only the webhook: the post-call webhook needs a
 * signing secret that only exists in the ElevenLabs dashboard, so until
 * somebody creates it there, this is the only thing filing calls. It stays
 * useful afterwards as the net under a webhook delivery that never arrives.
 *
 * Idempotent on conversation_id, so running it twice files nothing twice.
 */

/** Vercel signs its own cron requests; a bearer secret covers other callers. */
function authorized(request: Request): boolean {
  if (request.headers.get('x-vercel-cron')) return true

  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const header = request.headers.get('authorization') ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (bearer && safeEqualStrings(bearer, cronSecret)) return true
  }

  const siteKey = process.env.SITE_API_KEY?.trim()
  const provided = request.headers.get('x-api-key')
  if (siteKey && provided && safeEqualStrings(provided, siteKey)) return true

  return false
}

function positiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const sinceHours = positiveInt(url.searchParams.get('since_hours'), 24)
  const notifyWithinMinutes = positiveInt(url.searchParams.get('notify_within_minutes'), 180)

  try {
    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)
    const result = await syncConversations(supabase, orgId, { sinceHours, notifyWithinMinutes })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron:elevenlabs]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
