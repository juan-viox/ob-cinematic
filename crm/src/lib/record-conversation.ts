/**
 * Filing one Olivia conversation in the CRM: the contact, a voice-agent
 * activity carrying the summary and transcript, and the email to the team.
 *
 * Two things call this. ElevenLabs' post-call webhook hands it a signed
 * payload the moment a call ends, and the sync job (lib/elevenlabs-sync)
 * hands it the same conversation pulled from the ElevenLabs API. The webhook
 * needs a signing secret that only exists in the ElevenLabs dashboard; the
 * sync needs only the API key, so the sync is what makes this work without
 * anyone configuring a webhook, and the webhook is a faster path when it is
 * configured. Both are idempotent on conversation_id, so a conversation that
 * arrives twice is filed once.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  LIMITS,
  createActivity,
  email as parseEmail,
  phone as parsePhone,
  splitName,
  upsertContact,
} from '@/lib/ingest'
import { transcriptToText, type PostCallPayload } from '@/lib/elevenlabs'
import { sendCallNotice } from '@/lib/call-notify'
import { notifyBell } from '@/lib/alerts'

export type ConversationData = NonNullable<PostCallPayload['data']>

export interface RecordConversationResult {
  conversationId: string
  activityId: string | null
  contactId: string | null
  duplicate: boolean
  emailed: boolean
}

/** Has this conversation already been filed? */
export async function conversationExists(
  supabase: SupabaseClient,
  orgId: string,
  conversationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('activities')
    .select('id')
    .eq('organization_id', orgId)
    .eq('metadata->>conversation_id', conversationId)
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export interface RecordConversationOptions {
  /** How the conversation reached us, kept on the activity for later reading. */
  via: 'elevenlabs_webhook' | 'elevenlabs_sync'
  /**
   * Email the team about this one. The sync passes false for conversations
   * older than its notice window, so a first run over past calls files the
   * history without posting a pile of mail about calls already dealt with.
   */
  notify: boolean
}

export async function recordConversation(
  supabase: SupabaseClient,
  orgId: string,
  data: ConversationData,
  options: RecordConversationOptions
): Promise<RecordConversationResult> {
  const conversationId = data.conversation_id!

  const existingId = await conversationExists(supabase, orgId, conversationId)
  if (existingId) {
    return { conversationId, activityId: existingId, contactId: null, duplicate: true, emailed: false }
  }

  const turns = data.transcript ?? []
  const userTurns = turns.filter((t) => t.message && t.message.trim() && t.role === 'user')
  const phoneCall = data.metadata?.phone_call
  const callerPhone = parsePhone(phoneCall?.external_number)

  // Anything Olivia captured through her tools names the caller better than
  // the caller id does.
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
  capturedEmail = capturedEmail ?? parseEmail(collected.email?.value ?? collected.email_address?.value)
  capturedName =
    capturedName ?? (typeof collected.name?.value === 'string' ? collected.name.value : null)

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
  const transcript = transcriptToText({ type: 'post_call_transcription', data }).slice(0, LIMITS.transcript)
  const startedAt = data.metadata?.start_time_unix_secs
    ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
    : new Date().toISOString()

  const description = [summary, transcript ? `\nTranscript\n${transcript}` : null]
    .filter(Boolean)
    .join('\n')

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
      via: options.via,
    },
  })

  // The team hears about every conversation by email, so a call that booked
  // nothing still gets a human follow up. A failure here is logged, never
  // thrown: the call is already filed, and the caller of this function would
  // otherwise retry and file it twice.
  let emailed = false
  if (options.notify) {
    emailed = await sendCallNotice({
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

    // The bell as well as the inbox. The email above is the better record of
    // a call, so it keeps the writing; this only makes sure a call cannot be
    // missed by somebody who is in the CRM rather than in their mail.
    await notifyBell(supabase, {
      orgId,
      kind: 'voice_call',
      headline: capturedName
        ? `${capturedName} called`
        : capturedPhone ?? callerPhone
          ? `Call from ${capturedPhone ?? callerPhone}`
          : 'Call captured',
      details: [
        ['About', titleBits || summary?.slice(0, 120) || null],
        ['Phone', capturedPhone ?? callerPhone],
        ['Email', capturedEmail],
      ],
      entityType: contactId ? 'contact' : null,
      entityId: contactId,
    })
  }

  return { conversationId, activityId, contactId, duplicate: false, emailed }
}
