import {
  LIMITS,
  authorizeIngest,
  email,
  ensureTag,
  errorResponse,
  getIngestClient,
  getOrgId,
  handleOptions,
  isSpam,
  jsonError,
  jsonOk,
  readJsonBody,
  str,
  tagEntity,
  upsertContact,
} from '@/lib/ingest'

const NEWSLETTER_TAG = { name: 'newsletter', color: '#fdcb6e' }

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/ingest/newsletter
 * Body: { email, firstName? }
 */
export async function POST(request: Request) {
  try {
    const auth = authorizeIngest(request)
    if (!auth.ok) return jsonError(request, auth.error, auth.status)

    const body = await readJsonBody(request)
    if (isSpam(body)) return jsonOk(request, { success: true })

    const emailValue = email(body.email ?? body.emailAddress)
    if (!emailValue) return jsonError(request, 'A valid email address is required', 400)
    const firstName = str(body.firstName, LIMITS.name)

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const contact = await upsertContact(supabase, {
      orgId,
      trusted: auth.via === 'api_key',
      email: emailValue,
      firstName,
      source: 'newsletter',
    })

    const tagId = await ensureTag(supabase, orgId, NEWSLETTER_TAG.name, NEWSLETTER_TAG.color)
    if (tagId) await tagEntity(supabase, tagId, 'contact', contact.id)

    return jsonOk(request, { success: true, contactId: contact.id, created: contact.created })
  } catch (err) {
    return errorResponse(request, err, 'newsletter')
  }
}
