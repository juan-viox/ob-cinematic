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
  getStageIdByName,
  handleOptions,
  isSpam,
  jsonError,
  jsonOk,
  num,
  phone,
  readJsonBody,
  splitName,
  str,
  upsertContact,
} from '@/lib/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPayPalConfig, verifyPayPalOrder } from '@/lib/paypal'
import { createOrder, formatAddress, normaliseAddress } from '@/lib/orders'

/** Stage a captured (paid) order lands in; falls back to the first stage. */
const ORDER_STAGE_NAME = 'Approved'

/** PayPal order ids are alphanumeric (e.g. 5O190127TN364715T); keep the check strict. */
const PAYPAL_ORDER_ID_RE = /^[A-Za-z0-9_-]{4,64}$/

/** A cart of 50 distinct boxes is already far past anything we would ship
 *  unreviewed; beyond that it is a malformed or hostile body, not an order. */
const MAX_LINES = 50

/** One line of an order: a product, its colourway, unit price and count. */
interface OrderLine {
  name: string
  variant: string | null
  unitAmount: number
  quantity: number
}

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

/**
 * Parses the cart. Returns null when the caller sent no items at all (the
 * older single-product body, which is still accepted), the line array when
 * they are well formed, or a message describing the first bad line.
 */
function parseLines(v: unknown): OrderLine[] | string | null {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) return 'items must be an array of order lines'
  if (v.length === 0) return 'items must contain at least one line'
  if (v.length > MAX_LINES) return `items may contain at most ${MAX_LINES} lines`

  const lines: OrderLine[] = []
  for (let i = 0; i < v.length; i++) {
    const raw = v[i]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return `items[${i}] must be an object`
    }
    const row = raw as Record<string, unknown>

    const name = str(row.name ?? row.productName ?? row.product, LIMITS.title)
    if (!name) return `items[${i}].name is required`

    const unitAmount = num(row.unitAmount ?? row.unit_amount ?? row.price)
    if (unitAmount === null || unitAmount < 0 || unitAmount > 1_000_000) {
      return `items[${i}].unitAmount must be a non-negative number`
    }

    const qtyRaw =
      row.quantity === undefined || row.quantity === null || row.quantity === ''
        ? 1
        : num(row.quantity)
    if (qtyRaw === null || !Number.isInteger(qtyRaw) || qtyRaw < 1 || qtyRaw > 10_000) {
      return `items[${i}].quantity must be a positive integer`
    }

    lines.push({ name, variant: str(row.variant, LIMITS.name), unitAmount, quantity: qtyRaw })
  }
  return lines
}

/** "Host's Delight · Rose" — the colourway is part of what was bought. */
function lineLabel(line: OrderLine): string {
  return line.variant ? `${line.name} \u00b7 ${line.variant}` : line.name
}

/** Money adds up in cents. 105.10 × 3 in floats does not. */
function linesTotal(lines: OrderLine[]): number {
  const cents = lines.reduce(
    (sum, line) => sum + Math.round(line.unitAmount * 100) * line.quantity,
    0
  )
  return cents / 100
}

/** A deal title someone can read in a list view without opening it. */
function orderTitle(prefix: string, lines: OrderLine[], totalUnits: number): string {
  if (lines.length === 1) return `${prefix}: ${lineLabel(lines[0])} x${lines[0].quantity}`
  const head = lines
    .slice(0, 2)
    .map((line) => `${lineLabel(line)} x${line.quantity}`)
    .join(', ')
  const rest = lines.length - 2
  return `${prefix}: ${totalUnits} boxes · ${head}${rest > 0 ? ` +${rest} more` : ''}`
}

/** Existing deal for this PayPal order id within the org, if any. */
async function findExistingOrderDeal(
  supabase: SupabaseClient,
  orgId: string,
  paypalOrderId: string
): Promise<string | null> {
  const marker = orderMarker(paypalOrderId)
  const { data, error } = await supabase
    .from('deals')
    .select('id, notes')
    .eq('organization_id', orgId)
    .ilike('notes', `%${marker}%`)
    .limit(5)
  if (error) {
    console.error('[ingest:order] idempotency lookup failed:', error.message)
    return null
  }
  const rows = (data ?? []) as Array<{ id: string; notes: string | null }>
  // ilike treats "_" as a wildcard; confirm the exact marker in code.
  const match = rows.find((row) => (row.notes ?? '').includes(marker))
  return match?.id ?? null
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
 * alongside them must agree with it to the penny — the cart and the total are
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

    const parsedLines = parseLines(body.items ?? body.lineItems)
    if (typeof parsedLines === 'string') return jsonError(request, parsedLines, 400)

    const statedAmount = body.amount === undefined || body.amount === null || body.amount === ''
      ? null
      : num(body.amount)
    if (body.amount !== undefined && body.amount !== null && body.amount !== '' && statedAmount === null) {
      return jsonError(request, 'amount must be a non-negative number', 400)
    }

    let lines: OrderLine[]
    let amount: number

    if (parsedLines) {
      lines = parsedLines
      amount = linesTotal(lines)
      // The cart and the total are two claims about the same purchase.
      if (statedAmount !== null && Math.abs(statedAmount - amount) > 0.005) {
        return jsonError(
          request,
          `amount ${statedAmount.toFixed(2)} does not match the items total ${amount.toFixed(2)}`,
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
      lines = [
        {
          name: productName,
          variant: str(body.variant, LIMITS.name),
          unitAmount: Math.round((statedAmount / quantityRaw) * 100) / 100,
          quantity: quantityRaw,
        },
      ]
    }

    if (amount > 1_000_000) {
      return jsonError(request, 'amount must be a non-negative number', 400)
    }

    const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0)

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

    const { firstName, lastName } = splitName(payerName)

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    // Idempotency: same PayPal order id → same deal, no duplicate writes.
    const existingDealId = await findExistingOrderDeal(supabase, orgId, paypalOrderId)
    if (existingDealId) {
      return jsonOk(request, { success: true, dealId: existingDealId, duplicate: true })
    }

    // Contact (optional: PayPal normally provides payer email, but record the order regardless).
    let contactId: string | null = null
    let contactCreated = false
    if (payerEmail || payerName) {
      const contact = await upsertContact(supabase, {
        orgId,
        trusted: auth.via === 'api_key',
        email: payerEmail,
        firstName,
        lastName,
        source: 'web_form',
      })
      contactId = contact.id
      contactCreated = contact.created
    }

    const payerLabel = fullName(firstName, lastName) || payerEmail || 'Guest'
    const amountLabel = `${amount.toFixed(2)} ${currency}`
    const summary =
      lines.length === 1
        ? `${lineLabel(lines[0])} x${lines[0].quantity}`
        : `${totalUnits} boxes across ${lines.length} products`
    const stageId = verified
      ? await getStageIdByName(supabase, orgId, ORDER_STAGE_NAME)
      : await getFirstStageId(supabase, orgId)
    if (!stageId) {
      console.error('[ingest:order] no deal stages configured for org', orgId)
      return jsonError(request, 'CRM pipeline is not configured yet', 503)
    }

    // The packing list lives in the notes, one line per product, because that
    // is what whoever fulfils the order actually needs to read.
    const itemLines = lines.map(
      (line) =>
        `  ${lineLabel(line)} x${line.quantity} - ${(Math.round(line.unitAmount * 100) * line.quantity / 100).toFixed(2)} ${currency}` +
        (line.quantity > 1 ? ` (${line.unitAmount.toFixed(2)} each)` : '')
    )
    const shipLine = formatAddress(shipToAddress)
    const notes = [
      orderMarker(paypalOrderId),
      'Items:',
      ...itemLines,
      `Total: ${amountLabel}`,
      `Payer: ${payerLabel}${payerEmail && payerLabel !== payerEmail ? ` <${payerEmail}>` : ''}`,
      shipLine ? `Ship to: ${shipToName ? `${shipToName}, ` : ''}${shipLine}` : null,
      `Status: ${status}`,
      verified
        ? `Verified: ${verifiedBy === 'paypal' ? 'PayPal API' : 'trusted API key'}`
        : 'UNVERIFIED: reported by the website only - confirm this order in PayPal before fulfilling.',
    ].filter(Boolean).join('\n')

    const titlePrefix = verified ? 'Order' : 'Unverified order'
    const dealRow: Record<string, unknown> = {
      organization_id: orgId,
      contact_id: contactId,
      stage_id: stageId,
      title: orderTitle(titlePrefix, lines, totalUnits).slice(0, LIMITS.title),
      amount,
      close_date: new Date().toISOString().slice(0, 10),
      notes,
    }
    if (verified) dealRow.probability = 100

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert(dealRow)
      .select('id')
      .single()

    if (dealError || !deal) {
      console.error('[ingest:order] deal insert failed:', dealError?.message)
      return jsonError(request, 'Unable to save order', 500)
    }
    const dealId = deal.id as string

    // The order itself: line items linked to the catalogue, the shipping
    // address, and a stock movement for every product the team counts.
    const order = await createOrder(supabase, {
      orgId,
      source: 'website',
      contactId,
      dealId,
      paymentStatus: verified ? 'paid' : 'unverified',
      paymentProvider: 'paypal',
      paymentReference: paypalOrderId,
      payerName,
      payerEmail,
      payerPhone,
      shipToName: shipToName ?? payerName,
      shipToAddress,
      currency,
      subtotal: amount,
      total: amount,
      verified,
      verifiedBy,
      notes,
      metadata: { via: auth.via, paypalOrderId },
      lines,
    })

    const activityId = await createActivity(supabase, {
      orgId,
      contactId,
      dealId,
      type: 'note',
      title: verified
        ? `Order ${order.orderNumber} captured (PayPal ${paypalOrderId})`
        : `Order ${order.orderNumber} reported, unverified (PayPal ${paypalOrderId})`,
      description: `${summary} - ${amountLabel} ${verified ? 'paid by' : 'reported by'} ${payerLabel}`,
      status: 'completed',
      completedAt: new Date().toISOString(),
      metadata: {
        paypalOrderId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        items: lines,
        // Kept so anything reading the old shape still finds something sensible.
        productName: lines.length === 1 ? lines[0].name : summary,
        quantity: totalUnits,
        amount,
        currency,
        payerEmail,
        payerName,
        shipTo: shipToAddress,
        status,
        via: auth.via,
        verified,
        verifiedBy,
        unmatchedLines: order.unmatchedLines,
      },
    })

    if (order.unmatchedLines.length) {
      console.warn('[ingest:order] lines with no catalogue match:', order.unmatchedLines.join(', '))
    }

    return jsonOk(request, {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      dealId,
      contactId,
      activityId,
      created: contactCreated,
      duplicate: false,
      verified,
    })
  } catch (err) {
    return errorResponse(request, err, 'order')
  }
}
