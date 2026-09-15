import {
  LIMITS,
  authorizeIngest,
  createActivity,
  errorResponse,
  fullName,
  getIngestClient,
  getOrgId,
  handleOptions,
  isSpam,
  jsonError,
  jsonOk,
  num,
  phone,
  readJsonBody,
  splitName,
  str,
  upsertContact,
} from '@/lib/ingest'

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/ingest/voice-call
 * Body: { phone, callerName?, duration?, transcript?, agentId?, summary? }
 * Typically called server-to-server (x-api-key) by the voice agent platform.
 */
export async function POST(request: Request) {
  try {
    const auth = authorizeIngest(request)
    if (!auth.ok) return jsonError(request, auth.error, auth.status)

    const body = await readJsonBody(request)
    if (isSpam(body)) return jsonOk(request, { success: true })

    const phoneValue = phone(body.phone ?? body.callerPhone)
    if (!phoneValue) return jsonError(request, 'A valid phone number is required', 400)

    const callerName = str(body.callerName ?? body.name, LIMITS.name * 2)
    const { firstName, lastName } = splitName(callerName)
    const transcript = str(body.transcript, LIMITS.transcript)
    const summary = str(body.summary, LIMITS.message)
    const agentId = str(body.agentId, 100)
    const durationRaw = num(body.duration)
    const duration = durationRaw !== null && durationRaw >= 0 ? Math.round(durationRaw) : null

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const contact = await upsertContact(supabase, {
      orgId,
      trusted: auth.via === 'api_key',
      phone: phoneValue,
      firstName,
      lastName,
      source: 'voice_agent',
    })

    const displayName = fullName(firstName, lastName)
    const now = new Date().toISOString()

    const activityId = await createActivity(supabase, {
      orgId,
      contactId: contact.id,
      type: 'voice_agent',
      title: `Voice call${displayName ? ` with ${displayName}` : ''}`,
      description: summary ?? (transcript ? transcript.slice(0, 500) : null),
      status: 'completed',
      completedAt: now,
      metadata: {
        transcript,
        summary,
        duration,
        agentId,
        phone: phoneValue,
        via: auth.via,
      },
    })

    return jsonOk(request, {
      success: true,
      contactId: contact.id,
      activityId,
      created: contact.created,
    })
  } catch (err) {
    return errorResponse(request, err, 'voice-call')
  }
}
