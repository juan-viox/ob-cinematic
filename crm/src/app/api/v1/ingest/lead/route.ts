import {
  LIMITS,
  authorizeIngest,
  createActivity,
  email,
  errorResponse,
  findOrCreateCompany,
  fullName,
  getFirstStageId,
  getIngestClient,
  getOrgId,
  handleOptions,
  isSpam,
  jsonError,
  jsonOk,
  phone,
  readJsonBody,
  splitName,
  str,
  upsertContact,
  type ContactSource,
} from '@/lib/ingest'
import { notifyTeam } from '@/lib/alerts'

const LEAD_SOURCES: readonly ContactSource[] = ['web_form', 'voice_agent', 'referral']

const SOURCE_LABEL: Record<string, string> = {
  web_form: 'website form',
  voice_agent: 'voice agent',
  referral: 'referral',
}

function leadSource(v: unknown): ContactSource | null {
  if (v === undefined || v === null || v === '') return 'web_form'
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return (LEAD_SOURCES as readonly string[]).includes(s) ? (s as ContactSource) : null
}

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/ingest/lead
 * Body: { firstName?, lastName?, name?, emailAddress|email, phone?, description|message, company?, source? }
 */
export async function POST(request: Request) {
  try {
    const auth = authorizeIngest(request)
    if (!auth.ok) return jsonError(request, auth.error, auth.status)

    const body = await readJsonBody(request)
    if (isSpam(body)) return jsonOk(request, { success: true })

    // Names: explicit first/last win; otherwise split a single `name` field.
    let firstName = str(body.firstName, LIMITS.name)
    let lastName = str(body.lastName, LIMITS.name)
    if (!firstName && !lastName) {
      const split = splitName(str(body.name, LIMITS.name * 2))
      firstName = split.firstName
      lastName = split.lastName
    }

    const emailValue = email(body.emailAddress ?? body.email)
    const phoneValue = phone(body.phone)
    const message = str(body.description ?? body.message, LIMITS.message)
    const company = str(body.company, LIMITS.company)
    const source = leadSource(body.source)

    if (!source) {
      return jsonError(request, `source must be one of: ${LEAD_SOURCES.join(', ')}`, 400)
    }
    if (body.emailAddress !== undefined || body.email !== undefined) {
      if (!emailValue) return jsonError(request, 'A valid email address is required', 400)
    }
    if (!emailValue && !phoneValue) {
      return jsonError(request, 'An email address or phone number is required', 400)
    }

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const companyId = company ? await findOrCreateCompany(supabase, orgId, company) : null

    const contact = await upsertContact(supabase, {
      orgId,
      trusted: auth.via === 'api_key',
      email: emailValue,
      phone: phoneValue,
      firstName,
      lastName,
      source,
      notes: message,
      companyId,
    })

    const displayName = fullName(firstName, lastName) || emailValue || phoneValue || 'Unknown'

    // Deal in the first pipeline stage.
    let dealId: string | null = null
    const stageId = await getFirstStageId(supabase, orgId)
    if (stageId) {
      const noteLines = [
        `Source: ${SOURCE_LABEL[source] ?? source}`,
        company ? `Company: ${company}` : null,
        message ? `\n${message}` : null,
      ].filter(Boolean)
      const { data: deal, error: dealError } = await supabase
        .from('deals')
        .insert({
          organization_id: orgId,
          contact_id: contact.id,
          company_id: companyId,
          stage_id: stageId,
          title: `Lead: ${displayName}`.slice(0, LIMITS.title),
          amount: 0,
          notes: noteLines.join('\n'),
        })
        .select('id')
        .single()
      if (dealError) console.error('[ingest:lead] deal insert failed:', dealError.message)
      dealId = (deal?.id as string | undefined) ?? null
    } else {
      console.error('[ingest:lead] no deal stages configured for org', orgId)
    }

    const activityId = await createActivity(supabase, {
      orgId,
      contactId: contact.id,
      dealId,
      type: 'note',
      title: `New lead from ${SOURCE_LABEL[source] ?? source}: ${displayName}`,
      description: message ?? `Inquiry from ${displayName}${company ? ` (${company})` : ''}`,
      status: 'completed',
      completedAt: new Date().toISOString(),
      metadata: {
        source,
        via: auth.via,
        company,
        email: emailValue,
        phone: phoneValue,
      },
    })

    // Somebody we have never heard from is asking a question. Alerted on both
    // channels, after the record is safely written, and never fatal.
    await notifyTeam(supabase, {
      orgId,
      kind: source === 'voice_agent' ? 'voice_call' : 'lead',
      headline: company ? `${displayName} at ${company}` : displayName,
      details: [
        ['Came from', SOURCE_LABEL[source] ?? source],
        ['Email', emailValue],
        ['Phone', phoneValue],
        ['Company', company],
      ],
      body: message,
      path: '/leads',
      entityType: 'contact',
      entityId: contact.id,
    })

    return jsonOk(request, {
      success: true,
      contactId: contact.id,
      dealId,
      activityId,
      created: contact.created,
    })
  } catch (err) {
    return errorResponse(request, err, 'lead')
  }
}
