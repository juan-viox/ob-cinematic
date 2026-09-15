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
  readJsonBody,
  splitName,
  str,
  upsertContact,
} from '@/lib/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPayPalConfig, verifyPayPalOrder } from '@/lib/paypal'

/** Stage a captured (paid) order lands in; falls back to the first stage. */
const ORDER_STAGE_NAME = 'Approved'

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
 * Body: { productName, amount, quantity?, currency?, paypalOrderId, payerEmail?, payerName?, status: 'paid' }
 * Idempotent on paypalOrderId.
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

    const productName = str(body.productName ?? body.product, LIMITS.title)
    if (!productName) return jsonError(request, 'productName is required', 400)

    const amount = num(body.amount)
    if (amount === null || amount < 0 || amount > 1_000_000) {
      return jsonError(request, 'amount must be a non-negative number', 400)
    }

    const quantityRaw = body.quantity === undefined || body.quantity === null || body.quantity === '' ? 1 : num(body.quantity)
    if (quantityRaw === null || !Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > 10_000) {
      return jsonError(request, 'quantity must be a positive integer', 400)
    }
    const quantity = quantityRaw

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
    const stageId = verified
      ? await getStageIdByName(supabase, orgId, ORDER_STAGE_NAME)
      : await getFirstStageId(supabase, orgId)
    if (!stageId) {
      console.error('[ingest:order] no deal stages configured for org', orgId)
      return jsonError(request, 'CRM pipeline is not configured yet', 503)
    }

    const notes = [
      orderMarker(paypalOrderId),
      `Product: ${productName}`,
      `Quantity: ${quantity}`,
      `Amount: ${amountLabel}`,
      `Payer: ${payerLabel}${payerEmail && payerLabel !== payerEmail ? ` <${payerEmail}>` : ''}`,
      `Status: ${status}`,
      verified
        ? `Verified: ${verifiedBy === 'paypal' ? 'PayPal API' : 'trusted API key'}`
        : 'UNVERIFIED: reported by the website only — confirm this order in PayPal before fulfilling.',
    ].join('\n')

    const titlePrefix = verified ? 'Order' : 'Unverified order'
    const dealRow: Record<string, unknown> = {
      organization_id: orgId,
      contact_id: contactId,
      stage_id: stageId,
      title: `${titlePrefix}: ${productName} x${quantity}`.slice(0, LIMITS.title),
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

    const activityId = await createActivity(supabase, {
      orgId,
      contactId,
      dealId,
      type: 'note',
      title: verified
        ? `PayPal order ${paypalOrderId} captured`
        : `PayPal order ${paypalOrderId} reported (unverified)`,
      description: `${productName} x${quantity} — ${amountLabel} ${verified ? 'paid by' : 'reported by'} ${payerLabel}`,
      status: 'completed',
      completedAt: new Date().toISOString(),
      metadata: {
        paypalOrderId,
        productName,
        quantity,
        amount,
        currency,
        payerEmail,
        payerName,
        status,
        via: auth.via,
        verified,
        verifiedBy,
      },
    })

    return jsonOk(request, {
      success: true,
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
