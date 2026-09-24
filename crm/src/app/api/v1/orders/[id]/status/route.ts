import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  orderConfirmedText,
  orderDeliveredText,
  orderShippedText,
  sendSms,
  type SmsOutcome,
} from '@/lib/sms'

/**
 * POST /api/v1/orders/[id]/status
 * Body: { status, carrier?, trackingNumber? }
 *
 * Moving an order along, and telling the customer. The orders page used to
 * write the status straight to the database from the browser, which is fine
 * for a status and no good for a text message: the Twilio credentials must
 * never reach a browser. So the move happens here, and the message goes out
 * from the same place, which also means the two can never disagree.
 *
 * A text that cannot be sent never fails the status change. The order has
 * moved either way, and the reason is recorded on the customer's timeline.
 */

const STATUSES = ['new', 'confirmed', 'packing', 'shipped', 'delivered', 'cancelled'] as const
type Status = (typeof STATUSES)[number]

function firstNameOf(order: { payer_name?: string | null; ship_to_name?: string | null }): string | null {
  const full = (order.payer_name ?? order.ship_to_name ?? '').trim()
  if (!full) return null
  const first = full.split(/\s+/)[0]
  return first && first.length <= 40 ? first : null
}

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

  const status = typeof body.status === 'string' ? (body.status as Status) : null
  if (!status || !STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
  }
  const carrier = typeof body.carrier === 'string' && body.carrier.trim() ? body.carrier.trim().slice(0, 60) : null
  const trackingNumber =
    typeof body.trackingNumber === 'string' && body.trackingNumber.trim()
      ? body.trackingNumber.trim().slice(0, 100)
      : null

  const admin = createAdminClient()
  const { data: order, error: readError } = await admin
    .from('orders')
    .select('id, order_number, contact_id, deal_id, payer_name, payer_phone, ship_to_name, carrier, tracking_number, fulfillment_status, sms_consent')
    .eq('organization_id', ctx.organizationId)
    .eq('id', id)
    .maybeSingle()
  if (readError || !order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = { fulfillment_status: status }
  if (status === 'shipped') {
    patch.shipped_at = new Date().toISOString()
    if (carrier) patch.carrier = carrier
    if (trackingNumber) patch.tracking_number = trackingNumber
  }
  if (status === 'delivered') patch.delivered_at = new Date().toISOString()

  const { error: updateError } = await admin
    .from('orders')
    .update(patch)
    .eq('organization_id', ctx.organizationId)
    .eq('id', id)
  if (updateError) {
    console.error('[orders:status]', updateError.message)
    return NextResponse.json({ error: 'Could not update the order' }, { status: 500 })
  }

  // Only the three moments a customer actually wants to hear about. Packing
  // and cancelling are ours to know, not theirs to be pinged about.
  let sms: SmsOutcome | null = null
  const context = {
    orderNumber: order.order_number as string,
    firstName: firstNameOf(order),
    carrier: carrier ?? (order.carrier as string | null),
    trackingNumber: trackingNumber ?? (order.tracking_number as string | null),
  }
  const text =
    status === 'confirmed' ? orderConfirmedText(context)
    : status === 'shipped' ? orderShippedText(context)
    : status === 'delivered' ? orderDeliveredText(context)
    : null

  if (text && status !== order.fulfillment_status) {
    sms = await sendSms(admin, {
      orgId: ctx.organizationId,
      to: order.payer_phone as string | null,
      body: text,
      contactId: order.contact_id as string | null,
      dealId: order.deal_id as string | null,
      kind: status === 'confirmed' ? 'order_confirmed' : status === 'shipped' ? 'order_shipped' : 'order_delivered',
      consent: order.sms_consent === true,
      metadata: { orderId: order.id, orderNumber: order.order_number },
    })
  }

  return NextResponse.json({ ok: true, status, carrier: patch.carrier ?? order.carrier, trackingNumber: patch.tracking_number ?? order.tracking_number, sms })
}
