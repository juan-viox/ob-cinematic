import { NextResponse } from 'next/server'
import { LIMITS, email, getIngestClient, getOrgId, phone, str } from '@/lib/ingest'
import { normaliseAddress } from '@/lib/orders'
import { recordPaidOrder, type OrderLine } from '@/lib/record-order'
import {
  customFieldValue,
  fetchCheckoutLineItems,
  fetchCheckoutSession,
  getStripeConfig,
  paymentIntentId,
  shippingOf,
  verifyStripeSignature,
  type StripeCheckoutSession,
  type StripeLineItem,
} from '@/lib/stripe'

/** The events that mean money arrived. Cards complete synchronously; bank
 *  debits complete later and arrive as async_payment_succeeded. */
const PAID_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{8,}$/

/** A requested date the buyer typed, when it is a real date. Anything else
 *  stays in the notes as typed. */
function neededByFrom(raw: string | null): string | null {
  if (!raw) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const parsed = iso ? Date.parse(`${raw}T12:00:00Z`) : Date.parse(raw)
  if (!Number.isFinite(parsed)) return null
  const date = new Date(parsed)
  const now = Date.now()
  // A date more than a year out or in the past is more likely a typo than a plan.
  if (date.getTime() < now - 7 * 86_400_000 || date.getTime() > now + 366 * 86_400_000) return null
  return date.toISOString().slice(0, 10)
}

function linesFrom(items: StripeLineItem[]): { lines: OrderLine[]; feeCents: number } {
  const lines: OrderLine[] = []
  let feeCents = 0
  for (const item of items) {
    const product = item.price?.product
    const meta = (product && typeof product === 'object' ? product.metadata : null) ?? {}
    const quantity = Math.max(1, Math.round(item.quantity ?? 1))
    if (meta.kind === 'processing') {
      feeCents += item.amount_total ?? 0
      continue
    }
    const fallbackName = (product && typeof product === 'object' ? product.name : null) ?? item.description ?? 'Gift box'
    const name = str(meta.name, LIMITS.title) ?? str(fallbackName, LIMITS.title) ?? 'Gift box'
    lines.push({
      name,
      variant: str(meta.variant, LIMITS.name),
      card: str(meta.card, LIMITS.name),
      cardMessage: str(meta.message, LIMITS.title),
      unitAmount: (item.price?.unit_amount ?? 0) / 100,
      quantity,
    })
  }
  return { lines, feeCents }
}

async function recordSession(session: StripeCheckoutSession, items: StripeLineItem[]) {
  const { lines, feeCents } = linesFrom(items)
  if (lines.length === 0) throw new Error(`Stripe session ${session.id} has no product lines`)

  const itemsTotal = lines.reduce((sum, l) => sum + Math.round(l.unitAmount * 100) * l.quantity, 0) / 100
  const processingFee = feeCents / 100
  const amount = (session.amount_total ?? Math.round((itemsTotal + processingFee) * 100)) / 100
  const currency = (session.currency ?? 'usd').toUpperCase()

  const reference = paymentIntentId(session) ?? session.id
  const details = session.customer_details ?? null
  const shipping = shippingOf(session)
  const payerName = str(details?.name, LIMITS.name * 2)
  const shipToName = str(shipping?.name, LIMITS.name * 2) ?? payerName
  const shipToAddress = normaliseAddress(shipping?.address) ?? normaliseAddress(details?.address)

  const deliveryDate = customFieldValue(session, 'delivery_date')
  const recipientName = customFieldValue(session, 'recipient_name')
  const extraNotes = [
    deliveryDate ? `Requested delivery: ${deliveryDate}` : null,
    recipientName ? `Gift for: ${recipientName}` : null,
  ].filter((n): n is string => Boolean(n))
  // Discounts or tax would make the total differ from items plus fee; say so
  // rather than hide it.
  if (Math.abs(amount - (itemsTotal + processingFee)) > 0.005) {
    extraNotes.push(`Stripe charged ${amount.toFixed(2)} ${currency}; items ${itemsTotal.toFixed(2)} plus processing ${processingFee.toFixed(2)}`)
  }

  const supabase = getIngestClient()
  const orgId = await getOrgId(supabase)
  return recordPaidOrder(supabase, orgId, {
    provider: 'stripe',
    reference,
    marker: `Stripe payment ${reference}`,
    lines,
    itemsTotal,
    processingFee,
    amount,
    currency,
    payerEmail: email(details?.email),
    payerName,
    payerPhone: phone(details?.phone),
    smsConsent: session.metadata?.sms_consent === 'yes',
    shipToName,
    shipToAddress,
    neededBy: neededByFrom(deliveryDate),
    verified: true,
    verifiedBy: 'stripe',
    via: 'webhook',
    trustedContact: true,
    extraNotes,
    metadata: {
      stripeSessionId: session.id,
      stripePaymentIntent: paymentIntentId(session),
      deliveryDate,
      recipientName,
    },
  })
}

/**
 * POST /api/v1/webhooks/stripe
 *
 * Stripe's endpoint for checkout.session.completed (and the async variant).
 * The body is checked against STRIPE_WEBHOOK_SECRET before anything is
 * read, then the session and its line items are fetched from Stripe rather
 * than taken from the event, and the order is recorded through the same
 * path as a PayPal sale. A 2xx tells Stripe to stop; anything else makes it
 * retry, which is what we want when the CRM is briefly unreachable.
 */
export async function POST(request: Request) {
  const config = getStripeConfig()
  if (!config?.webhookSecret) {
    console.error('[webhook:stripe] STRIPE_WEBHOOK_SECRET is not set; refusing event')
    return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 503 })
  }

  const raw = await request.text()
  if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), config.webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: { id?: unknown; type?: unknown; data?: { object?: { id?: unknown } } }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Malformed event' }, { status: 400 })
  }

  const type = typeof event.type === 'string' ? event.type : ''
  if (!PAID_EVENTS.has(type)) {
    return NextResponse.json({ received: true, ignored: type || 'unknown' })
  }
  const sessionId = event.data?.object?.id
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Event carries no checkout session' }, { status: 400 })
  }

  const session = await fetchCheckoutSession(config, sessionId)
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: 502 })
  if (session.data.payment_status !== 'paid') {
    // A delayed payment method: the async_payment_succeeded event follows.
    return NextResponse.json({ received: true, ignored: `payment_status ${session.data.payment_status}` })
  }

  const items = await fetchCheckoutLineItems(config, sessionId)
  if (!items.ok) return NextResponse.json({ error: items.error }, { status: 502 })

  try {
    const result = await recordSession(session.data, items.data)
    return NextResponse.json({ received: true, ...result })
  } catch (err) {
    console.error('[webhook:stripe] failed to record order:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Unable to record order' }, { status: 500 })
  }
}
