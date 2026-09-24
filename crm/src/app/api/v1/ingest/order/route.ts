import {
  authorizeIngest,
  email,
  errorResponse,
  fullName,
  getIngestClient,
  getOrgId,
  handleOptions,
  isSpam,
  jsonError,
  jsonOk,
  num,
  phone,
  readJsonBody,
  str,
  LIMITS,
} from '@/lib/ingest'
import { getPayPalConfig, verifyPayPalOrder } from '@/lib/paypal'
import { normaliseAddress } from '@/lib/orders'
import { linesTotal, parseCartLines, recordPaidOrder, type OrderLine } from '@/lib/record-order'

/** PayPal order ids are alphanumeric (e.g. 5O190127TN364715T); keep the check strict. */
const PAYPAL_ORDER_ID_RE = /^[A-Za-z0-9_-]{4,64}$/

/** Marker written into deals.notes so the order can be found again (idempotency). */
function orderMarker(paypalOrderId: string): string {
  return `PayPal order ${paypalOrderId}`
}

function orderStatus(v: unknown): 'paid' | null {
  if (v === undefined || v === null || v === '') return 'paid'
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return s === 'paid' || s === 'completed' || s === 'captured' ? 'paid' : null
}

function currencyCode(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return 'USD'
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(s) ? s : null
}

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/ingest/order
 *
 * Body (cart, preferred):
 *   { items: [{ name, unitAmount, quantity? }, …], amount?, currency?,
 *     paypalOrderId, payerEmail?, payerName?, status: 'paid' }
 *
 * Body (single product, still accepted):
 *   { productName, amount, quantity?, currency?, paypalOrderId, … }
 *
 * The order total is computed from the lines, in cents, and an `amount` sent
 * alongside them must agree with it to the penny; the cart and the total are
 * two claims about the same purchase, and a mismatch means one of them is
 * wrong. Idempotent on paypalOrderId.
 *
 * Trust model (the Origin check alone is spoofable, so a body must never be
 * taken as proof of payment):
 *  - PAYPAL_CLIENT_ID/PAYPAL_SECRET set → the order is fetched from PayPal and
 *    must be COMPLETED with a matching amount/currency; payer details come
 *    from PayPal. Mismatch → 400. Verified orders land in 'Approved'.
 *  - No PayPal credentials, caller authenticated with x-api-key → trusted
 *    (server-to-server, e.g. a PayPal webhook relay) → 'Approved'.
 *  - No PayPal credentials, origin-only caller → recorded as
 *    "Unverified order: …" in the FIRST stage (not Approved, no 100%
 *    probability) so the team confirms it in PayPal before fulfilling.
 *
 * Stripe orders never come through here: Stripe reports them itself to
 * /api/v1/webhooks/stripe. Both end in lib/record-order.
 */
export async function POST(request: Request) {
  try {
    const auth = authorizeIngest(request)
    if (!auth.ok) return jsonError(request, auth.error, auth.status)

    const body = await readJsonBody(request)
    if (isSpam(body)) return jsonOk(request, { success: true })

    const paypalOrderId = str(body.paypalOrderId ?? body.orderId, 64)
    if (!paypalOrderId || !PAYPAL_ORDER_ID_RE.test(paypalOrderId)) {
      return jsonError(request, 'A valid paypalOrderId is required', 400)
    }

    const parsedLines = parseCartLines(body.items ?? body.lineItems)
    if (typeof parsedLines === 'string') return jsonError(request, parsedLines, 400)

    // Processing and handling rides alongside the line items rather than
    // inside them, so the cart total is the items plus this and the books can
    // still tell the sale from the cost of taking the money.
    const feeRaw = body.processingFee ?? body.handlingAmount
    const processingFee = feeRaw === undefined || feeRaw === null || feeRaw === '' ? 0 : num(feeRaw)
    if (processingFee === null || processingFee < 0 || processingFee > 100_000) {
      return jsonError(request, 'processingFee must be a non-negative number', 400)
    }

    const statedAmount = body.amount === undefined || body.amount === null || body.amount === ''
      ? null
      : num(body.amount)
    if (body.amount !== undefined && body.amount !== null && body.amount !== '' && statedAmount === null) {
      return jsonError(request, 'amount must be a non-negative number', 400)
    }

    let lines: OrderLine[]
    let amount: number
    /** The line items alone. `amount` is this plus processing, and it is what
     *  PayPal captured, so verification has to compare against `amount`. */
    let itemsTotal: number

    if (parsedLines) {
      lines = parsedLines
      itemsTotal = linesTotal(lines)
      amount = Math.round((itemsTotal + processingFee) * 100) / 100
      // The cart and the total are two claims about the same purchase.
      if (statedAmount !== null && Math.abs(statedAmount - amount) > 0.005) {
        return jsonError(
          request,
          `amount ${statedAmount.toFixed(2)} does not match the items total ${itemsTotal.toFixed(2)} plus ` +
            `processing ${processingFee.toFixed(2)}`,
          400
        )
      }
    } else {
      // Single-product body: the amount is the line total, not the unit price.
      const productName = str(body.productName ?? body.product, LIMITS.title)
      if (!productName) return jsonError(request, 'productName or items is required', 400)

      if (statedAmount === null || statedAmount < 0 || statedAmount > 1_000_000) {
        return jsonError(request, 'amount must be a non-negative number', 400)
      }

      const quantityRaw =
        body.quantity === undefined || body.quantity === null || body.quantity === ''
          ? 1
          : num(body.quantity)
      if (quantityRaw === null || !Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > 10_000) {
        return jsonError(request, 'quantity must be a positive integer', 400)
      }

      amount = statedAmount
      itemsTotal = Math.round((statedAmount - processingFee) * 100) / 100
      lines = [
        {
          name: productName,
          variant: str(body.variant, LIMITS.name),
          card: str(body.card, LIMITS.name),
          cardMessage: str(body.message ?? body.cardMessage, LIMITS.title),
          unitAmount: Math.round((statedAmount / quantityRaw) * 100) / 100,
          quantity: quantityRaw,
        },
      ]
    }

    if (amount > 1_000_000) {
      return jsonError(request, 'amount must be a non-negative number', 400)
    }

    const currency = currencyCode(body.currency)
    if (!currency) return jsonError(request, 'currency must be a 3-letter ISO code', 400)

    const status = orderStatus(body.status)
    if (!status) return jsonError(request, "status must be 'paid'", 400)

    const rawPayerEmail = body.payerEmail ?? body.email
    let payerEmail = email(rawPayerEmail)
    if (typeof rawPayerEmail === 'string' && rawPayerEmail.trim() && !payerEmail) {
      return jsonError(request, 'payerEmail must be a valid email address', 400)
    }
    let payerName = str(body.payerName ?? body.name, LIMITS.name * 2)
    const payerPhone = phone(body.payerPhone ?? body.phone)
    // Only a literal true counts: a missing or garbled field means no texts.
    const smsConsent = body.smsConsent === true
    const shippingRaw = (body.shipping ?? null) as { name?: unknown; address?: unknown } | null
    let shipToName = shippingRaw && typeof shippingRaw.name === 'string' ? str(shippingRaw.name, LIMITS.name * 2) : null
    let shipToAddress = normaliseAddress(shippingRaw?.address)

    // Server-side verification (see the trust model above).
    let verified = false
    let verifiedBy: 'paypal' | 'api_key' | null = null
    const paypal = getPayPalConfig()
    if (paypal) {
      const verification = await verifyPayPalOrder(paypal, paypalOrderId, { amount, currency })
      if (!verification.ok) return jsonError(request, verification.error, verification.status)
      verified = true
      verifiedBy = 'paypal'
      // Payer identity comes from PayPal, not from the (spoofable) body.
      if (verification.order.payerEmail) payerEmail = email(verification.order.payerEmail)
      const paypalName = fullName(verification.order.payerGivenName, verification.order.payerSurname)
      if (paypalName) payerName = str(paypalName, LIMITS.name * 2)
      // Where PayPal says it ships beats where the browser said it ships.
      if (verification.order.shipToName) shipToName = str(verification.order.shipToName, LIMITS.name * 2)
      const paypalAddress = normaliseAddress(verification.order.shipToAddress)
      if (paypalAddress) shipToAddress = paypalAddress
    } else if (auth.via === 'api_key') {
      verified = true
      verifiedBy = 'api_key'
    }

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const result = await recordPaidOrder(supabase, orgId, {
      provider: 'paypal',
      reference: paypalOrderId,
      marker: orderMarker(paypalOrderId),
      lines,
      itemsTotal,
      processingFee,
      amount,
      currency,
      payerEmail,
      payerName,
      payerPhone,
      smsConsent,
      shipToName,
      shipToAddress,
      verified,
      verifiedBy,
      via: auth.via,
      trustedContact: auth.via === 'api_key',
    })

    if (result.duplicate) {
      return jsonOk(request, { success: true, dealId: result.dealId, duplicate: true })
    }

    return jsonOk(request, { success: true, ...result })
  } catch (err) {
    return errorResponse(request, err, 'order')
  }
}
