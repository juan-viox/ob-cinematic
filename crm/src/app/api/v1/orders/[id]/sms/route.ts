import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_SMS_CHARS, sendSms } from '@/lib/sms'

/**
 * POST /api/v1/orders/[id]/sms
 * Body: { message }
 *
 * A text to the customer behind an order, in Kari's or Sarah's own words:
 * a delay, a question about the card, a note that the box went out early.
 * The automatic messages cover the order's milestones; this covers
 * everything else without anyone having to leave the CRM.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  if (!session.ok) return session.response
  const { ctx } = session

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'A message is required' }, { status: 400 })
  if (message.length > MAX_SMS_CHARS) {
    return NextResponse.json({ error: `Keep it under ${MAX_SMS_CHARS} characters` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin
    .from('orders')
    .select('id, order_number, contact_id, deal_id, payer_phone, sms_consent')
    .eq('organization_id', ctx.organizationId)
    .eq('id', id)
    .maybeSingle()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const sms = await sendSms(admin, {
    orgId: ctx.organizationId,
    to: order.payer_phone as string | null,
    body: message,
    contactId: order.contact_id as string | null,
    dealId: order.deal_id as string | null,
    kind: 'manual',
    consent: order.sms_consent === true,
    metadata: { orderId: order.id, orderNumber: order.order_number, by: ctx.email },
  })

  if (!sms.sent) {
    const why =
      sms.reason === 'opted_out' ? 'This customer asked us to stop texting.'
      : sms.reason === 'no_consent' ? 'This customer did not agree to order texts at checkout. Email or call instead.'
      : sms.reason === 'no_number' ? 'There is no usable mobile number on this order.'
      : sms.reason === 'not_configured' ? 'Texting is not set up yet.'
      : 'The message could not be sent.'
    return NextResponse.json({ ok: false, error: why, sms }, { status: 400 })
  }
  return NextResponse.json({ ok: true, sms })
}
