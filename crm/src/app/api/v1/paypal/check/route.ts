import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { fetchPayPalOrder, getPayPalConfig, probePayPal } from '@/lib/paypal'

/**
 * GET /api/v1/paypal/check[?orderId=…]
 *
 * Two questions, in the order you need them answered.
 *
 * Without an orderId: are the credentials real, are they pointed at the right
 * PayPal, and do they belong to the same app the shop checks out with? All
 * three can be settled before a single order exists, which is the point — the
 * alternative is discovering a wrong key by watching a real customer's payment
 * land as "Unverified".
 *
 * With an orderId: what does PayPal actually say about that order, and would
 * the ingest route have accepted it? A real order that verifies here is the
 * only proof the whole path works, because it is the only thing that exercises
 * the merchant's ownership of the order rather than just the credentials.
 *
 * Never returns the secret, and never writes anything. A client id is public —
 * it ships in the shop's page source — so it is shown in full, because the
 * whole diagnosis often comes down to comparing it to the shop's.
 */

const ORDER_ID_RE = /^[A-Za-z0-9_-]{4,64}$/

export async function GET(request: Request) {
  const session = await requireSession()
  if (!session.ok) return session.response

  const probe = await probePayPal()

  const orderId = new URL(request.url).searchParams.get('orderId')?.trim()
  if (!orderId) {
    return NextResponse.json({ probe, order: null }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (!ORDER_ID_RE.test(orderId)) {
    return NextResponse.json(
      { probe, order: null, error: 'That does not look like a PayPal order id.' },
      { status: 400 }
    )
  }

  const config = getPayPalConfig()
  if (!config) {
    return NextResponse.json(
      { probe, order: null, error: 'PayPal is not connected, so there is nothing to look the order up with.' },
      { status: 400 }
    )
  }

  const result = await fetchPayPalOrder(config, orderId)
  if (!result.ok) {
    return NextResponse.json({
      probe,
      order: null,
      error:
        result.error === 'PayPal order not found'
          ? `PayPal has no order ${orderId} on ${probe.env}. If the payment definitely went through, these credentials belong to a different PayPal account or app than the one that took it.`
          : result.error,
    })
  }

  // What the ingest route checks, reported rather than enforced: it compares
  // against the amount the cart claimed, and there is no cart here, so say
  // what PayPal holds and let the caller compare it to the order in the CRM.
  const { order } = result
  return NextResponse.json(
    {
      probe,
      order: {
        id: order.id,
        status: order.status,
        completed: order.status === 'COMPLETED',
        amount: order.amount,
        currency: order.currency,
        payerEmail: order.payerEmail,
        payerName: [order.payerGivenName, order.payerSurname].filter(Boolean).join(' ') || null,
        shipToName: order.shipToName,
        shipToAddress: order.shipToAddress,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
