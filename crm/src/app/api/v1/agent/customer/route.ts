import {
  email as parseEmail,
  getIngestClient,
  getOrgId,
  handleOptions,
  jsonError,
  jsonOk,
  phone as parsePhone,
  readJsonBody,
} from '@/lib/ingest'
import { withAgentAuth, money } from '@/lib/agent-api'
import { addDays, toISODate, today } from '@/lib/occasions'

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/agent/customer
 * Body: { phone?, email? }
 *
 * "Is this someone we know?" Olivia calls it at the start of a call with the
 * caller id, or once someone gives their email, and greets a returning client
 * by name with their open work and upcoming dates in front of her.
 */
export async function POST(request: Request) {
  return withAgentAuth(request, 'customer', async () => {
    const body = await readJsonBody(request)
    const emailValue = parseEmail(body.email ?? body.emailAddress)
    const phoneValue = parsePhone(body.phone)
    if (!emailValue && !phoneValue) return jsonError(request, 'phone or email is required', 400)

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const columns = 'id, first_name, last_name, email, phone, status, created_at, notes, company:companies(name)'
    let contact: Record<string, unknown> | null = null

    if (emailValue) {
      const { data } = await supabase.from('contacts').select(columns).eq('organization_id', orgId).eq('email', emailValue).maybeSingle()
      contact = data as Record<string, unknown> | null
    }
    if (!contact && phoneValue) {
      // Phones are stored as typed; match on the last ten digits however they were punctuated.
      const digits = phoneValue.replace(/\D/g, '').slice(-10)
      if (digits.length >= 7) {
        const pattern = `%${digits.split('').join('%')}%`
        const { data } = await supabase
          .from('contacts')
          .select(columns)
          .eq('organization_id', orgId)
          .ilike('phone', pattern)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        contact = data as Record<string, unknown> | null
      }
    }

    if (!contact) {
      return jsonOk(request, { success: true, found: false, message: 'No existing customer matches. Treat them as new and capture their details.' })
    }

    const contactId = contact.id as string
    const [dealsRes, ordersRes, occasionsRes] = await Promise.all([
      supabase
        .from('deals')
        .select('id, title, amount, needed_by, quantity, occasion, stage:deal_stages(name)')
        .eq('organization_id', orgId)
        .eq('contact_id', contactId)
        .is('closed_at', null)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('orders')
        .select('order_number, placed_at, total, fulfillment_status, items:order_items(description, quantity)')
        .eq('organization_id', orgId)
        .eq('contact_id', contactId)
        .order('placed_at', { ascending: false })
        .limit(3),
      supabase
        .from('client_occasions')
        .select('title, occasion_date, status, quantity, recipient_name')
        .eq('organization_id', orgId)
        .eq('contact_id', contactId)
        .gte('occasion_date', toISODate(today()))
        .lte('occasion_date', toISODate(addDays(today(), 120)))
        .order('occasion_date', { ascending: true })
        .limit(5),
    ])

    const company = (contact.company as { name?: string } | null)?.name ?? null
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

    return jsonOk(request, {
      success: true,
      found: true,
      contact: {
        id: contactId,
        name,
        first_name: contact.first_name,
        email: contact.email,
        phone: contact.phone,
        company,
        status: contact.status,
        customer_since: String(contact.created_at ?? '').slice(0, 10),
      },
      open_deals: (dealsRes.data ?? []).map((d: Record<string, unknown>) => ({
        title: d.title,
        stage: (d.stage as { name?: string } | null)?.name ?? null,
        amount: money(d.amount as number),
        needed_by: d.needed_by,
        quantity: d.quantity,
        occasion: d.occasion,
      })),
      recent_orders: (ordersRes.data ?? []).map((o: Record<string, unknown>) => ({
        order_number: o.order_number,
        placed_on: String(o.placed_at ?? '').slice(0, 10),
        total: money(o.total as number),
        status: o.fulfillment_status,
        items: ((o.items as Array<{ description: string; quantity: number }>) ?? [])
          .map((i) => `${i.description} x${i.quantity}`)
          .join(', '),
      })),
      upcoming_occasions: (occasionsRes.data ?? []).map((c: Record<string, unknown>) => ({
        title: c.title,
        date: c.occasion_date,
        status: c.status,
        quantity: c.quantity,
        recipient: c.recipient_name,
      })),
    })
  })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
