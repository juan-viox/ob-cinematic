import { NextResponse } from 'next/server'
import {
  LIMITS,
  createActivity,
  email as parseEmail,
  getIngestClient,
  getOrgId,
  phone as parsePhone,
  splitName,
  upsertContact,
} from '@/lib/ingest'
import { transcriptToText, verifyElevenLabsSignature, type PostCallPayload } from '@/lib/elevenlabs'
import { sendCallNotice } from '@/lib/call-notify'

/**
 * POST /api/v1/elevenlabs/post-call
 *
 * ElevenLabs' post-call webhook: every conversation Olivia has, on the phone
 * or in the site widget, lands in the CRM as a voice-agent activity with the
 * summary, the transcript and the tools she used. Configure it in the
 * ElevenLabs dashboard (Settings → Webhooks → Post-call) with this URL and
 * put the signing secret in ELEVENLABS_WEBHOOK_SECRET.
 *
 * Idempotent on conversation_id: ElevenLabs retries on non-2xx, and a retry
 * must not create a second activity.
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

  const data = payload.data
  const conversationId = data.conversation_id!

  try {
    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const { data: existing } = await supabase
      .from('activities')
      .select('id')
      .eq('organization_id', orgId)
      .eq('metadata->>conversation_id', conversationId)
      .limit(1)
      .maybeSingle()
    if (existing?.id) return NextResponse.json({ ok: true, duplicate: true, activityId: existing.id })

    const turns = data.transcript ?? []
    const userTurns = turns.filter((t) => t.role === 'user' && t.message && t.message.trim())
    const phoneCall = data.metadata?.phone_call
    const inbound = (phoneCall?.direction ?? 'inbound') === 'inbound'
    const callerPhone = parsePhone(inbound ? phoneCall?.external_number : phoneCall?.external_number)

    // Anything Olivia captured through her tools names the caller better
    // than the caller id does.
    let capturedEmail: string | null = null
    let capturedName: string | null = null
    let capturedPhone: string | null = null
    const toolsUsed = new Set<string>()
    for (const t of turns) {
      for (const call of t.tool_calls ?? []) {
        if (call.tool_name) toolsUsed.add(call.tool_name)
        if (!call.params_as_json) continue
        try {
          const params = JSON.parse(call.params_as_json) as Record<string, unknown>
          capturedEmail = capturedEmail ?? parseEmail(params.emailAddress ?? params.email)
          capturedPhone = capturedPhone ?? parsePhone(params.phone)
          const first = typeof params.firstName === 'string' ? params.firstName.trim() : ''
          const last = typeof params.lastName === 'string' ? params.lastName.trim() : ''
          const full = typeof params.name === 'string' ? params.name.trim() : ''
          capturedName = capturedName ?? ([first, last].filter(Boolean).join(' ') || full || null)
        } catch {
          // a tool call with unparseable params is still a tool call
        }
      }
    }
    const collected = data.analysis?.data_collection_results ?? {}
    const collectedEmail = parseEmail(collected.email?.value ?? collected.email_address?.value)
    const collectedName = typeof collected.name?.value === 'string' ? collected.name.value : null
    capturedEmail = capturedEmail ?? collectedEmail
    capturedName = capturedName ?? collectedName

    // A contact only when there is someone to attach the call to: a caller id
    // and at least one thing they said, or an email Olivia captured.
    let contactId: string | null = null
    const phoneForContact = capturedPhone ?? callerPhone
    if (capturedEmail || (phoneForContact && userTurns.length > 0)) {
      const { firstName, lastName } = splitName(capturedName)
      const contact = await upsertContact(supabase, {
        orgId,
        trusted: true,
        email: capturedEmail,
        phone: phoneForContact,
        firstName: firstName ?? (capturedEmail ? null : 'Caller'),
        lastName,
        source: 'voice_agent',
      })
      contactId = contact.id
    }

    const summary = data.analysis?.transcript_summary?.trim() || null
    const titleBits = data.analysis?.call_summary_title?.trim()
    const source = data.metadata?.conversation_initiation_source ?? (phoneCall ? 'phone' : 'widget')
    const duration = data.metadata?.call_duration_secs ?? null
    const transcript = transcriptToText(payload).slice(0, LIMITS.transcript)
    const startedAt = data.metadata?.start_time_unix_secs
      ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
      : new Date().toISOString()

    const description = [summary, transcript ? `\nTranscript\n${transcript}` : null].filter(Boolean).join('\n')

    const activityId = await createActivity(supabase, {
      orgId,
      contactId,
      type: 'voice_agent',
      title: `Olivia ${phoneCall ? 'call' : 'chat'}${titleBits ? `: ${titleBits}` : ''}`.slice(0, LIMITS.title),
      description: description.slice(0, LIMITS.message + LIMITS.transcript) || null,
      status: 'completed',
      completedAt: startedAt,
      metadata: {
        conversation_id: conversationId,
        agent_id: data.agent_id ?? null,
        source,
        direction: phoneCall?.direction ?? null,
        phone: callerPhone,
        duration,
        call_successful: data.analysis?.call_successful ?? null,
        summary,
        tools_used: [...toolsUsed],
        user_turns: userTurns.length,
        data_collection: collected,
        via: 'elevenlabs_webhook',
      },
    })

    // The team hears about every conversation by email, so a call that
    // booked nothing still gets a human follow up. Failure is logged, never
    // returned: ElevenLabs would retry and file the call twice.
    const emailed = await sendCallNotice({
      conversationId,
      kind: phoneCall ? 'call' : 'chat',
      startedAt,
      durationSecs: duration,
      callerPhone: capturedPhone ?? callerPhone,
      callerName: capturedName,
      callerEmail: capturedEmail,
      title: titleBits || null,
      summary,
      transcript,
      toolsUsed: [...toolsUsed],
      callSuccessful: data.analysis?.call_successful ?? null,
      contactId,
      activityId,
    })

    return NextResponse.json({ ok: true, activityId, contactId, emailed })
  } catch (err) {
    console.error('[elevenlabs:post-call]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
