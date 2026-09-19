import { NextResponse } from 'next/server'
import { getIngestClient, getOrgId } from '@/lib/ingest'
import { verifyElevenLabsSignature, type PostCallPayload } from '@/lib/elevenlabs'
import { recordConversation } from '@/lib/record-conversation'

/**
 * POST /api/v1/elevenlabs/post-call
 *
 * ElevenLabs' post-call webhook: every conversation Olivia has, on the phone
 * or in the site widget, lands in the CRM as a voice-agent activity with the
 * summary, the transcript and the tools she used, and the team gets an email
 * about it. Configure it in the ElevenLabs dashboard (Settings → Webhooks →
 * Post-call) with this URL and put the signing secret in
 * ELEVENLABS_WEBHOOK_SECRET.
 *
 * This is the fast path, not the only one: the signing secret can only be
 * created in that dashboard, so /api/v1/cron/elevenlabs pulls the same
 * conversations from the ElevenLabs API on a schedule and files whatever
 * this never delivered. Both are idempotent on conversation_id.
 */

const MAX_BODY = 2 * 1024 * 1024

export async function POST(request: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'ELEVENLABS_WEBHOOK_SECRET is not configured' }, { status: 503 })
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'Unable to read body' }, { status: 400 })
  }
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'Body too large' }, { status: 413 })

  const sig = verifyElevenLabsSignature(request.headers.get('elevenlabs-signature'), raw, secret)
  if (!sig.ok) return NextResponse.json({ error: sig.reason }, { status: 401 })

  let payload: PostCallPayload
  try {
    payload = JSON.parse(raw) as PostCallPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Audio and other event types are acknowledged and ignored.
  if (payload.type !== 'post_call_transcription' || !payload.data?.conversation_id) {
    return NextResponse.json({ ok: true, ignored: payload.type ?? 'unknown' })
  }

  try {
    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)
    const result = await recordConversation(supabase, orgId, payload.data, {
      via: 'elevenlabs_webhook',
      notify: true,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[elevenlabs:post-call]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
