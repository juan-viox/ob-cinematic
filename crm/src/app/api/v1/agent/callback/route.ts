import {
  LIMITS,
  createActivity,
  email as parseEmail,
  fullName,
  getIngestClient,
  getOrgId,
  handleOptions,
  isoDate,
  jsonError,
  jsonOk,
  phone as parsePhone,
  readJsonBody,
  splitName,
  str,
  upsertContact,
} from '@/lib/ingest'
import { withAgentAuth } from '@/lib/agent-api'
import { addDays, toISODate, today } from '@/lib/occasions'

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/agent/callback
 * Body: { name?, firstName?, lastName?, phone, email?, preferredTime?, topic? }
 *
 * A call-back request from Sarah or Kari: a pending call in the calendar and
 * the Tasks list, at the time the caller asked for (or the next business
 * morning when they did not say).
 */
export async function POST(request: Request) {
  return withAgentAuth(request, 'callback', async () => {
    const body = await readJsonBody(request)
    const phoneValue = parsePhone(body.phone)
    if (!phoneValue) return jsonError(request, 'A phone number to call back is required', 400)

    let firstName = str(body.firstName, LIMITS.name)
    let lastName = str(body.lastName, LIMITS.name)
    if (!firstName && !lastName) {
      const split = splitName(str(body.name, LIMITS.name * 2))
      firstName = split.firstName
      lastName = split.lastName
    }
    const emailValue = parseEmail(body.email ?? body.emailAddress)
    const topic = str(body.topic ?? body.reason, LIMITS.message)
    const preferredRaw = str(body.preferredTime, 100)
    const preferredIso = isoDate(preferredRaw)

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const contact = await upsertContact(supabase, {
      orgId,
      trusted: true,
      phone: phoneValue,
      email: emailValue,
      firstName,
      lastName,
      source: 'voice_agent',
    })

    const displayName = fullName(firstName, lastName) || phoneValue
    // Next business morning, 10:00 local, unless they named a time.
    let due = preferredIso
    if (!due) {
      let d = addDays(today(), 1)
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1)
      due = `${toISODate(d)}T10:00:00`
    }

    const activityId = await createActivity(supabase, {
      orgId,
      contactId: contact.id,
      type: 'call',
      title: `Call back ${displayName}${topic ? `: ${topic.slice(0, 80)}` : ''}`,
      description: [`Phone: ${phoneValue}`, emailValue ? `Email: ${emailValue}` : null, preferredRaw ? `Preferred time: ${preferredRaw}` : null, topic]
        .filter(Boolean)
        .join('\n'),
      status: 'pending',
      dueDate: due,
      metadata: { via: 'voice_agent', priority: 'high', task_status: 'todo', preferredTime: preferredRaw },
    })

    return jsonOk(request, {
      success: true,
      contactId: contact.id,
      activityId,
      scheduled_for: due,
      message: `Done. Someone from the Occasions Box team will call ${displayName} back${preferredRaw ? ` around ${preferredRaw}` : ' on the next business day'}.`,
    })
  })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
