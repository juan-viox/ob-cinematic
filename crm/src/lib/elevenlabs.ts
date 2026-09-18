import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies an ElevenLabs post-call webhook.
 *
 * ElevenLabs signs the raw body with the webhook secret and sends
 *   ElevenLabs-Signature: t=<unix seconds>,v0=<hex hmac-sha256 of "<t>.<body>">
 * The timestamp is checked against a 30 minute window so a captured request
 * cannot be replayed later.
 */
export function verifyElevenLabsSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: 'missing signature header' }
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return i === -1 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    })
  ) as Record<string, string>

  const t = parts.t
  const v0 = parts.v0
  if (!t || !v0) return { ok: false, reason: 'malformed signature header' }

  const ts = Number(t)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 30 * 60) {
    return { ok: false, reason: 'signature timestamp outside the accepted window' }
  }

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(v0, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' }
  }
  return { ok: true }
}

/** The subset of the post_call_transcription payload the CRM reads. */
export interface PostCallPayload {
  type: string
  event_timestamp?: number
  data?: {
    agent_id?: string
    conversation_id?: string
    status?: string
    transcript?: Array<{
      role: 'agent' | 'user' | string
      message?: string | null
      time_in_call_secs?: number
      tool_calls?: Array<{ tool_name?: string; params_as_json?: string }>
      tool_results?: Array<{ tool_name?: string; result_value?: string; is_error?: boolean }>
    }>
    metadata?: {
      start_time_unix_secs?: number
      call_duration_secs?: number
      phone_call?: {
        direction?: string
        external_number?: string
        agent_number?: string
        call_sid?: string
      }
      conversation_initiation_source?: string
    }
    analysis?: {
      call_successful?: string
      transcript_summary?: string
      call_summary_title?: string
      data_collection_results?: Record<string, { value?: unknown; rationale?: string }>
      evaluation_criteria_results?: Record<string, { result?: string; rationale?: string }>
    }
    conversation_initiation_client_data?: {
      dynamic_variables?: Record<string, unknown>
    }
  }
}

/** "agent: …\nuser: …" for the activity description; capped by the caller. */
export function transcriptToText(payload: PostCallPayload): string {
  const turns = payload.data?.transcript ?? []
  return turns
    .filter((t) => t.message && t.message.trim())
    .map((t) => `${t.role === 'agent' ? 'Olivia' : 'Caller'}: ${t.message!.trim()}`)
    .join('\n')
}
