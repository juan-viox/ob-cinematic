import {
  LIMITS,
  createActivity,
  email as parseEmail,
  findOrCreateCompany,
  fullName,
  getFirstStageId,
  getIngestClient,
  getOrgId,
  handleOptions,
  isoDate,
  jsonError,
  jsonOk,
  num,
  phone as parsePhone,
  readJsonBody,
  splitName,
  str,
  upsertContact,
} from '@/lib/ingest'
import { withAgentAuth, money } from '@/lib/agent-api'
import { addDays, toISODate, today } from '@/lib/occasions'

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/agent/opportunity
 * Body: { firstName, lastName?, email?, phone?, company?, occasion?, quantity?,
 *         budgetPerBox?, neededBy?, boxes?, notes?, conversationId? }
 *
 * The one call that turns a conversation into pipeline: the contact (and
 * company) are created or updated, a deal lands in "Inquiry" with the
 * quantity, budget and date, a follow-up task is due tomorrow, and when there
 * is a date the occasion goes on the client's gifting calendar.
 */
export async function POST(request: Request) {
  return withAgentAuth(request, 'opportunity', async () => {
    const body = await readJsonBody(request)

    let firstName = str(body.firstName, LIMITS.name)
    let lastName = str(body.lastName, LIMITS.name)
    if (!firstName && !lastName) {
      const split = splitName(str(body.name, LIMITS.name * 2))
      firstName = split.firstName
      lastName = split.lastName
    }
    const emailValue = parseEmail(body.email ?? body.emailAddress)
    const phoneValue = parsePhone(body.phone)
    if (!emailValue && !phoneValue) {
      return jsonError(request, 'An email address or phone number is required so the team can follow up', 400)
    }
    if (!firstName) return jsonError(request, 'The caller\'s first name is required', 400)

    const company = str(body.company, LIMITS.company)
    const occasion = str(body.occasion, LIMITS.title)
    const quantityRaw = num(body.quantity)
    const quantity = quantityRaw !== null && quantityRaw >= 1 ? Math.round(Math.min(quantityRaw, 100_000)) : null
    const budgetRaw = num(body.budgetPerBox ?? body.budget)
    const budgetPerBox = budgetRaw !== null && budgetRaw > 0 ? Math.min(budgetRaw, 100_000) : null
    const neededByIso = isoDate(body.neededBy ?? body.date)
    const neededBy = neededByIso ? neededByIso.slice(0, 10) : null
    const boxes = str(body.boxes ?? body.boxInterest, LIMITS.message)
    const notes = str(body.notes ?? body.description, LIMITS.message)
    const conversationId = str(body.conversationId, 100)

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const companyId = company ? await findOrCreateCompany(supabase, orgId, company) : null
    const contact = await upsertContact(supabase, {
      orgId,
      trusted: true,
      email: emailValue,
      phone: phoneValue,
      firstName,
      lastName,
      source: 'voice_agent',
      companyId,
      notes: notes,
    })

    const displayName = fullName(firstName, lastName)
    const amount = quantity && budgetPerBox ? Math.round(quantity * budgetPerBox * 100) / 100 : 0
    const whatFor = occasion ?? 'Gifting inquiry'
    const title = `${whatFor}: ${quantity ? `${quantity} boxes` : 'inquiry'} for ${company ?? displayName}`.slice(0, LIMITS.title)

    const noteLines = [
      'Source: Olivia (voice agent)',
      occasion ? `Occasion: ${occasion}` : null,
      quantity ? `Quantity: ${quantity}` : null,
      budgetPerBox ? `Budget per box: ${money(budgetPerBox)}` : null,
      neededBy ? `Needed by: ${neededBy}` : null,
      boxes ? `Boxes of interest: ${boxes}` : null,
      company ? `Company: ${company}` : null,
      conversationId ? `Conversation: ${conversationId}` : null,
      notes ? `\n${notes}` : null,
    ].filter(Boolean)

    let dealId: string | null = null
    const stageId = await getFirstStageId(supabase, orgId)
    if (stageId) {
      const { data: deal, error } = await supabase
        .from('deals')
        .insert({
          organization_id: orgId,
          contact_id: contact.id,
          company_id: companyId,
          stage_id: stageId,
          title,
          amount,
          quantity,
          needed_by: neededBy,
          occasion,
          source: 'voice_agent',
          close_date: neededBy,
          notes: noteLines.join('\n'),
        })
        .select('id')
        .single()
      if (error) console.error('[agent:opportunity] deal insert failed:', error.message)
      dealId = (deal?.id as string | undefined) ?? null
    }

    await createActivity(supabase, {
      orgId,
      contactId: contact.id,
      dealId,
      type: 'note',
      title: `Opportunity from Olivia: ${whatFor}`,
      description: noteLines.join('\n'),
      status: 'completed',
      completedAt: new Date().toISOString(),
      metadata: { via: 'voice_agent', conversation_id: conversationId, quantity, budgetPerBox, neededBy, boxes },
    })

    // The team's follow-up, due tomorrow, in the Tasks list.
    const dueTomorrow = `${toISODate(addDays(today(), 1))}T14:00:00`
    await createActivity(supabase, {
      orgId,
      contactId: contact.id,
      dealId,
      type: 'task',
      title: `Follow up with ${displayName}${company ? ` (${company})` : ''}: ${whatFor}`,
      description: [quantity ? `${quantity} boxes` : null, budgetPerBox ? `${money(budgetPerBox)} each` : null, neededBy ? `needed by ${neededBy}` : null, emailValue, phoneValue]
        .filter(Boolean)
        .join(' · '),
      status: 'pending',
      dueDate: dueTomorrow,
      metadata: { priority: 'high', task_status: 'todo', via: 'voice_agent' },
    })

    // A dated occasion goes straight onto the client's gifting calendar.
    let clientOccasionId: string | null = null
    if (neededBy) {
      const { data: co, error } = await supabase
        .from('client_occasions')
        .insert({
          organization_id: orgId,
          contact_id: contact.id,
          company_id: companyId,
          title: whatFor,
          occasion_date: neededBy,
          quantity: quantity ?? 1,
          budget: budgetPerBox,
          status: 'planned',
          deal_id: dealId,
          notes: boxes ? `Boxes of interest: ${boxes}` : null,
        })
        .select('id')
        .single()
      if (error) console.error('[agent:opportunity] client_occasion insert failed:', error.message)
      clientOccasionId = (co?.id as string | undefined) ?? null
    }

    return jsonOk(request, {
      success: true,
      contactId: contact.id,
      dealId,
      clientOccasionId,
      created_contact: contact.created,
      message: `Saved. ${displayName}'s request is in the pipeline and the team will follow up within one business day${emailValue ? ` at ${emailValue}` : ''}.`,
    })
  })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
