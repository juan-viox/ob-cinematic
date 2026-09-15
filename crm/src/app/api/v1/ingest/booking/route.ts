import {
  LIMITS,
  authorizeIngest,
  createActivity,
  email,
  errorResponse,
  fullName,
  getFirstStageId,
  getIngestClient,
  getOrgId,
  handleOptions,
  isSpam,
  isoDate,
  jsonError,
  jsonOk,
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
 * POST /api/v1/ingest/booking
 * Body: { firstName?, lastName?, name?, email, phone?, service?, date?, notes? }
 */
export async function POST(request: Request) {
  try {
    const auth = authorizeIngest(request)
    if (!auth.ok) return jsonError(request, auth.error, auth.status)

    const body = await readJsonBody(request)
    if (isSpam(body)) return jsonOk(request, { success: true })

    let firstName = str(body.firstName, LIMITS.name)
    let lastName = str(body.lastName, LIMITS.name)
    if (!firstName && !lastName) {
      const split = splitName(str(body.name, LIMITS.name * 2))
      firstName = split.firstName
      lastName = split.lastName
    }

    const emailValue = email(body.email ?? body.emailAddress)
    const phoneValue = phone(body.phone)
    const service = str(body.service, LIMITS.title) ?? 'Service'
    const notes = str(body.notes ?? body.message, LIMITS.message)
    const rawDate = body.date
    const date = isoDate(rawDate)

    if ((body.email !== undefined || body.emailAddress !== undefined) && !emailValue) {
      return jsonError(request, 'A valid email address is required', 400)
    }
    if (!emailValue && !phoneValue) {
      return jsonError(request, 'An email address or phone number is required', 400)
    }
    if (rawDate !== undefined && rawDate !== null && rawDate !== '' && !date) {
      return jsonError(request, 'date must be an ISO-8601 date or datetime', 400)
    }

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const contact = await upsertContact(supabase, {
      orgId,
      trusted: auth.via === 'api_key',
      email: emailValue,
      phone: phoneValue,
      firstName,
      lastName,
      source: 'booking',
    })

    const displayName = fullName(firstName, lastName) || emailValue || phoneValue || 'Unknown'

    let dealId: string | null = null
    const stageId = await getFirstStageId(supabase, orgId)
    if (stageId) {
      const { data: deal, error: dealError } = await supabase
        .from('deals')
        .insert({
          organization_id: orgId,
          contact_id: contact.id,
          stage_id: stageId,
          title: `Booking: ${service} - ${displayName}`.slice(0, LIMITS.title),
          amount: 0,
          notes: [date ? `Requested date: ${date}` : null, notes].filter(Boolean).join('\n') || null,
        })
        .select('id')
        .single()
      if (dealError) console.error('[ingest:booking] deal insert failed:', dealError.message)
      dealId = (deal?.id as string | undefined) ?? null
    } else {
      console.error('[ingest:booking] no deal stages configured for org', orgId)
    }

    const activityId = await createActivity(supabase, {
      orgId,
      contactId: contact.id,
      dealId,
      type: 'meeting',
      title: `Booking: ${service}`,
      description: notes,
      status: 'pending',
      dueDate: date,
      metadata: { service, bookingDate: date, via: auth.via },
    })

    return jsonOk(request, {
      success: true,
      contactId: contact.id,
      dealId,
      activityId,
      created: contact.created,
    })
  } catch (err) {
    return errorResponse(request, err, 'booking')
  }
}
