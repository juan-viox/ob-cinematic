/**
 * Turning a paid cart into everything the CRM keeps about a sale: the
 * contact, a deal in the pipeline, the order with its lines and stock
 * movements, an invoice in the OB sequence, and an activity on the timeline.
 *
 * Shared by the PayPal ingest route (the browser reports the capture and
 * the route verifies it with PayPal) and the Stripe webhook (Stripe reports
 * the paid session itself). Both arrive here with the same shape, so an
 * order looks the same in /orders and on the invoice whichever way it was
 * paid.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  IngestError,
  LIMITS,
  createActivity,
  fullName,
  getFirstStageId,
  getStageIdByName,
  num,
  splitName,
  str,
  upsertContact,
} from '@/lib/ingest'
import { createOrder, formatAddress, type OrderLineInput } from '@/lib/orders'
import { notifyTeam } from '@/lib/alerts'
import { orderConfirmedText, sendSms } from '@/lib/sms'

/** Stage a verified (paid) order lands in; falls back to the first stage. */
const ORDER_STAGE_NAME = 'Approved'

/** A cart of 50 distinct boxes is already far past anything we would ship
 *  unreviewed; beyond that it is a malformed or hostile body, not an order. */
export const MAX_LINES = 50

/** One line of an order: a product, its colourway, the card and the count. */
export interface OrderLine extends OrderLineInput {
  name: string
  variant: string | null
  card: string | null
  cardMessage: string | null
  unitAmount: number
  quantity: number
}

export type PaymentProvider = 'paypal' | 'stripe'

export const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  paypal: 'PayPal',
  stripe: 'Stripe',
}

export interface PaidOrderInput {
  provider: PaymentProvider
  /** The provider's id for the payment: a PayPal order id or a Stripe payment intent id. */
  reference: string
  /** Written into deals.notes so a repeated report of the same payment finds the same deal. */
  marker: string
  lines: OrderLine[]
  /** The line items alone. */
  itemsTotal: number
  /** Processing and handling, charged on every order. */
  processingFee: number
  /** What the provider actually took: items plus processing. */
  amount: number
  currency: string
  payerEmail: string | null
  payerName: string | null
  payerPhone: string | null
  /** The buyer ticked "Text me order updates" at checkout. Without it the
   *  number is kept for the packing slip and never texted. */
  smsConsent: boolean
  shipToName: string | null
  shipToAddress: Record<string, string> | null
  /** The date the buyer asked for, when they gave one that parses. */
  neededBy?: string | null
  verified: boolean
  verifiedBy: 'paypal' | 'stripe' | 'api_key' | null
  /** How the report reached us. Kept in the activity for later reading. */
  via: 'origin' | 'api_key' | 'webhook'
  /** Whether the contact fields came from somewhere the CRM can trust. */
  trustedContact: boolean
  /** Extra lines for the packing notes: a requested date, who the gift is for. */
  extraNotes?: string[]
  metadata?: Record<string, unknown>
}

export interface PaidOrderResult {
  orderId: string
  orderNumber: string
  invoiceId: string | null
  invoiceNumber: string | null
  dealId: string
  contactId: string | null
  activityId: string | null
  created: boolean
  duplicate: boolean
  verified: boolean
}

/**
 * Parses a cart. Returns null when the caller sent no items at all, the
 * line array when they are well formed, or a message describing the first
 * bad line.
 */
export function parseCartLines(v: unknown): OrderLine[] | string | null {
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

    lines.push({
      name,
      variant: str(row.variant, LIMITS.name),
      card: str(row.card, LIMITS.name),
      cardMessage: str(row.message ?? row.cardMessage, LIMITS.title),
      unitAmount,
      quantity: qtyRaw,
    })
  }
  return lines
}

/** "Host's Delight · Rose". The colourway is part of what was bought. */
export function lineLabel(line: OrderLine): string {
  return line.variant ? `${line.name} · ${line.variant}` : line.name
}

/** Money adds up in cents. 105.10 × 3 in floats does not. */
export function linesTotal(lines: OrderLine[]): number {
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

/** Existing deal carrying this payment's marker within the org, if any. */
async function findExistingOrderDeal(
  supabase: SupabaseClient,
  orgId: string,
  marker: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('deals')
    .select('id, notes')
    .eq('organization_id', orgId)
    .ilike('notes', `%${marker}%`)
    .limit(5)
  if (error) {
    console.error('[orders] idempotency lookup failed:', error.message)
    return null
  }
  const rows = (data ?? []) as Array<{ id: string; notes: string | null }>
  // ilike treats "_" as a wildcard; confirm the exact marker in code.
  const match = rows.find((row) => (row.notes ?? '').includes(marker))
  return match?.id ?? null
}

export async function recordPaidOrder(
  supabase: SupabaseClient,
  orgId: string,
  input: PaidOrderInput
): Promise<PaidOrderResult> {
  const providerLabel = PROVIDER_LABEL[input.provider]
  const { lines, amount, currency, verified, verifiedBy } = input
  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0)

  // Idempotency: the same payment reported twice is one deal, no duplicate writes.
  const existingDealId = await findExistingOrderDeal(supabase, orgId, input.marker)
  if (existingDealId) {
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id, order_number, contact_id, metadata')
      .eq('organization_id', orgId)
      .eq('deal_id', existingDealId)
      .maybeSingle()
    const meta = (existingOrder?.metadata ?? {}) as Record<string, unknown>
    return {
      orderId: (existingOrder?.id as string | undefined) ?? '',
      orderNumber: (existingOrder?.order_number as string | undefined) ?? '',
      invoiceId: typeof meta.invoiceId === 'string' ? meta.invoiceId : null,
      invoiceNumber: typeof meta.invoiceNumber === 'string' ? meta.invoiceNumber : null,
      dealId: existingDealId,
      contactId: (existingOrder?.contact_id as string | null | undefined) ?? null,
      activityId: null,
      created: false,
      duplicate: true,
      verified,
    }
  }

  const { firstName, lastName } = splitName(input.payerName)

  // Contact (optional: the provider normally gives an email, but the order is
  // recorded regardless).
  let contactId: string | null = null
  let contactCreated = false
  if (input.payerEmail || input.payerName) {
    const contact = await upsertContact(supabase, {
      orgId,
      trusted: input.trustedContact,
      email: input.payerEmail,
      firstName,
      lastName,
      source: 'web_form',
    })
    contactId = contact.id
    contactCreated = contact.created
  }

  const payerLabel = fullName(firstName, lastName) || input.payerEmail || 'Guest'
  const amountLabel = `${amount.toFixed(2)} ${currency}`
  const summary =
    lines.length === 1
      ? `${lineLabel(lines[0])} x${lines[0].quantity}`
      : `${totalUnits} boxes across ${lines.length} products`
  const stageId = verified
    ? await getStageIdByName(supabase, orgId, ORDER_STAGE_NAME)
    : await getFirstStageId(supabase, orgId)
  if (!stageId) {
    console.error('[orders] no deal stages configured for org', orgId)
    throw new IngestError('CRM pipeline is not configured yet', 503)
  }

  // The packing list lives in the notes, one line per product, because that
  // is what whoever fulfils the order actually needs to read.
  const itemLines = lines.map(
    (line) =>
      `  ${lineLabel(line)} x${line.quantity} - ${(Math.round(line.unitAmount * 100) * line.quantity / 100).toFixed(2)} ${currency}` +
      (line.quantity > 1 ? ` (${line.unitAmount.toFixed(2)} each)` : '')
  )
  const shipLine = formatAddress(input.shipToAddress)
  const verifiedLine =
    verifiedBy === 'api_key'
      ? 'Verified: trusted API key'
      : verifiedBy
        ? `Verified: ${PROVIDER_LABEL[verifiedBy]} API`
        : null
  const notes = [
    input.marker,
    'Items:',
    ...itemLines,
    `Total: ${amountLabel}`,
    `Payer: ${payerLabel}${input.payerEmail && payerLabel !== input.payerEmail ? ` <${input.payerEmail}>` : ''}`,
    shipLine ? `Ship to: ${input.shipToName ? `${input.shipToName}, ` : ''}${shipLine}` : null,
    ...(input.extraNotes ?? []),
    'Status: paid',
    verified
      ? verifiedLine
      : `UNVERIFIED: reported by the website only - confirm this order in ${providerLabel} before fulfilling.`,
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
    console.error('[orders] deal insert failed:', dealError?.message)
    throw new IngestError('Unable to save order', 500)
  }
  const dealId = deal.id as string

  // The order itself: line items linked to the catalogue, the shipping
  // address, and a stock movement for every product the team counts.
  const baseMetadata: Record<string, unknown> = {
    via: input.via,
    provider: input.provider,
    paymentReference: input.reference,
    ...(input.provider === 'paypal' ? { paypalOrderId: input.reference } : {}),
    ...(input.metadata ?? {}),
  }
  const order = await createOrder(supabase, {
    orgId,
    source: 'website',
    contactId,
    dealId,
    paymentStatus: verified ? 'paid' : 'unverified',
    paymentProvider: input.provider,
    paymentReference: input.reference,
    payerName: input.payerName,
    payerEmail: input.payerEmail,
    payerPhone: input.payerPhone,
    smsConsent: input.smsConsent,
    shipToName: input.shipToName ?? input.payerName,
    shipToAddress: input.shipToAddress,
    neededBy: input.neededBy ?? null,
    currency,
    subtotal: input.itemsTotal,
    handlingAmount: input.processingFee,
    total: amount,
    verified,
    verifiedBy,
    notes,
    metadata: baseMetadata,
    lines,
  })

  // Every sale gets an invoice in the same OB sequence as the hand-issued
  // ones, so the books hold one numbered document per payment. 'paid' when
  // the provider confirmed the capture, otherwise 'sent', which the invoices
  // page counts as pending until someone confirms it. Never fatal: the order
  // is already saved, and a missing invoice is visible and fixable.
  let invoiceId: string | null = null
  let invoiceNumber: string | null = null
  if (!order.duplicate) {
    const { data: allocated, error: numberError } = await supabase.rpc('next_document_number', {
      p_org: orgId,
      p_kind: 'invoice',
      p_prefix: 'OB',
    })
    if (numberError || typeof allocated !== 'string') {
      console.error('[orders] invoice number failed:', numberError?.message)
    } else {
      const today = new Date().toISOString().slice(0, 10)
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          organization_id: orgId,
          contact_id: contactId,
          deal_id: dealId,
          invoice_number: allocated,
          status: verified ? 'paid' : 'sent',
          issue_date: today,
          due_date: today,
          subtotal: amount,
          tax_rate: 0,
          tax_amount: 0,
          total: amount,
          notes: `Order ${order.orderNumber}. ${providerLabel} ${input.reference}. ${
            verified ? 'Paid at checkout.' : `Reported by the website; confirm in ${providerLabel} before fulfilling.`
          }`,
        })
        .select('id')
        .single()
      if (invoiceError || !invoice) {
        console.error('[orders] invoice insert failed:', invoiceError?.message)
      } else {
        invoiceId = invoice.id as string
        invoiceNumber = allocated
        const items = lines.map((line, i) => ({
          invoice_id: invoiceId,
          description: lineLabel(line),
          quantity: line.quantity,
          unit_price: line.unitAmount,
          total: Math.round(line.unitAmount * 100 * line.quantity) / 100,
          sort_order: i,
        }))
        if (input.processingFee > 0) {
          items.push({
            invoice_id: invoiceId,
            description: 'Processing & Handling',
            quantity: 1,
            unit_price: input.processingFee,
            total: input.processingFee,
            sort_order: lines.length,
          })
        }
        const { error: itemsError } = await supabase.from('invoice_items').insert(items)
        if (itemsError) console.error('[orders] invoice items failed:', itemsError.message)
        await supabase
          .from('orders')
          .update({ metadata: { ...baseMetadata, invoiceId, invoiceNumber } })
          .eq('id', order.id)
      }
    }
  }

  const activityId = await createActivity(supabase, {
    orgId,
    contactId,
    dealId,
    type: 'note',
    title: verified
      ? `Order ${order.orderNumber} captured (${providerLabel} ${input.reference})`
      : `Order ${order.orderNumber} reported, unverified (${providerLabel} ${input.reference})`,
    description: `${summary} - ${amountLabel} ${verified ? 'paid by' : 'reported by'} ${payerLabel}`,
    status: 'completed',
    completedAt: new Date().toISOString(),
    metadata: {
      provider: input.provider,
      paymentReference: input.reference,
      ...(input.provider === 'paypal' ? { paypalOrderId: input.reference } : {}),
      orderId: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber,
      items: lines,
      // Kept so anything reading the old shape still finds something sensible.
      productName: lines.length === 1 ? lines[0].name : summary,
      quantity: totalUnits,
      amount,
      currency,
      payerEmail: input.payerEmail,
      payerName: input.payerName,
      shipTo: input.shipToAddress,
      status: 'paid',
      via: input.via,
      verified,
      verifiedBy,
      unmatchedLines: order.unmatchedLines,
    },
  })

  // The customer hears from us the moment the money lands, not whenever
  // somebody next opens the CRM. Never fatal: the sale is saved, and a text
  // that could not go out is recorded on the timeline with the reason.
  if (!order.duplicate) {
    await sendSms(supabase, {
      orgId,
      to: input.payerPhone,
      body: orderConfirmedText({
        orderNumber: order.orderNumber,
        firstName,
      }),
      contactId,
      dealId,
      kind: 'order_confirmed',
      consent: input.smsConsent,
      metadata: { orderId: order.id, orderNumber: order.orderNumber, provider: input.provider },
    })
  }

  if (order.unmatchedLines.length) {
    console.warn('[orders] lines with no catalogue match:', order.unmatchedLines.join(', '))
  }

  // The team hears about it too. After the customer's text and after the sale
  // is fully written, because notifyTeam never throws but this ordering means
  // an alert cannot delay the confirmation the buyer is waiting on.
  //
  // Only for orders that are new to us: a duplicate webhook is the same sale
  // arriving twice, and alerting on it teaches everybody to ignore alerts.
  if (!order.duplicate) {
    await notifyTeam(supabase, {
      orgId,
      kind: 'order',
      headline: `${order.orderNumber} from ${payerLabel} for ${amountLabel}`,
      details: [
        ['Order', order.orderNumber],
        ['Total', amountLabel],
        ['Items', summary],
        ['Customer', input.payerName ?? input.payerEmail ?? 'Not given'],
        ['Email', input.payerEmail],
        ['Phone', input.payerPhone],
        ['Ship to', input.shipToAddress ? formatAddress(input.shipToAddress) : null],
        ['Paid via', providerLabel],
        // Worth saying out loud: an unverified order has not been checked
        // against the payment provider, so it is not yet money in the bank.
        ['Verified', verified ? 'Yes' : 'NO, confirm in PayPal before shipping'],
        order.unmatchedLines.length
          ? ['Stock warning', `Not in catalogue, no stock deducted: ${order.unmatchedLines.join(', ')}`]
          : ['', ''],
      ],
      path: '/orders',
      entityType: 'deal',
      entityId: dealId,
    })
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    invoiceId,
    invoiceNumber,
    dealId,
    contactId,
    activityId,
    created: contactCreated,
    duplicate: false,
    verified,
  }
}
