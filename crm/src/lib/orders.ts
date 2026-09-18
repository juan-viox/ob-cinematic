import type { SupabaseClient } from '@supabase/supabase-js'
import { IngestError } from '@/lib/ingest'

/**
 * Turning a purchase into an order, its lines, and the stock that left the
 * shelf. Shared by the website ingest route and (later) an accepted proposal.
 */

export interface OrderLineInput {
  name: string
  variant?: string | null
  /** Which printed 5x7 card, or the blank one. */
  card?: string | null
  /** What to write inside it, in the buyer's words. */
  cardMessage?: string | null
  unitAmount: number
  quantity: number
}

export interface CreateOrderInput {
  orgId: string
  source: 'website' | 'proposal' | 'concierge' | 'manual' | 'voice_agent'
  contactId?: string | null
  companyId?: string | null
  dealId?: string | null
  proposalId?: string | null
  paymentStatus: 'unverified' | 'pending' | 'paid'
  paymentProvider?: string | null
  paymentReference?: string | null
  payerName?: string | null
  payerEmail?: string | null
  payerPhone?: string | null
  shipToName?: string | null
  shipToAddress?: Record<string, string> | null
  giftMessage?: string | null
  currency: string
  subtotal: number
  shippingAmount?: number
  taxAmount?: number
  total: number
  verified: boolean
  verifiedBy?: string | null
  notes?: string | null
  metadata?: Record<string, unknown>
  lines: OrderLineInput[]
}

export interface CreateOrderResult {
  id: string
  orderNumber: string
  matchedProducts: number
  unmatchedLines: string[]
}

/** A sequential, per-organisation order number (OB-0001). */
export async function nextOrderNumber(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', {
    p_org: orgId,
    p_kind: 'order',
    p_prefix: 'OB',
  })
  if (error || typeof data !== 'string') {
    // The counter is a convenience, not a gate: fall back to a timestamped
    // number rather than lose a paid order.
    console.error('[orders] next_document_number failed:', error?.message)
    return `OB-${Date.now().toString().slice(-8)}`
  }
  return data
}

/** Matches a cart line to a catalogue product by name (case-insensitive). */
async function catalogueByName(supabase: SupabaseClient, orgId: string) {
  const { data } = await supabase
    .from('products')
    .select('id, sku, name, track_stock')
    .eq('organization_id', orgId)
  const map = new Map<string, { id: string; sku: string | null; track_stock: boolean }>()
  for (const p of (data ?? []) as Array<{ id: string; sku: string | null; name: string; track_stock: boolean }>) {
    map.set(p.name.trim().toLowerCase(), { id: p.id, sku: p.sku, track_stock: p.track_stock })
  }
  return map
}

/**
 * Writes the order, its lines and, for any product whose stock is tracked, a
 * 'sold' movement that takes the boxes off the shelf. Returns the existing
 * order when the payment reference has already been recorded, so a repeated
 * webhook or a double-submitted cart cannot bill the shelf twice.
 */
export async function createOrder(
  supabase: SupabaseClient,
  input: CreateOrderInput
): Promise<CreateOrderResult & { duplicate: boolean }> {
  if (input.paymentReference) {
    const { data: existing } = await supabase
      .from('orders')
      .select('id, order_number')
      .eq('organization_id', input.orgId)
      .eq('payment_provider', input.paymentProvider ?? 'paypal')
      .eq('payment_reference', input.paymentReference)
      .maybeSingle()
    if (existing?.id) {
      return {
        id: existing.id as string,
        orderNumber: existing.order_number as string,
        matchedProducts: 0,
        unmatchedLines: [],
        duplicate: true,
      }
    }
  }

  const orderNumber = await nextOrderNumber(supabase, input.orgId)

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      organization_id: input.orgId,
      order_number: orderNumber,
      source: input.source,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
      proposal_id: input.proposalId ?? null,
      payment_status: input.paymentStatus,
      payment_provider: input.paymentProvider ?? null,
      payment_reference: input.paymentReference ?? null,
      payer_name: input.payerName ?? null,
      payer_email: input.payerEmail ?? null,
      payer_phone: input.payerPhone ?? null,
      fulfillment_status: 'new',
      ship_to_name: input.shipToName ?? null,
      ship_to_address: input.shipToAddress ?? null,
      gift_message: input.giftMessage ?? null,
      currency: input.currency,
      subtotal: input.subtotal,
      shipping_amount: input.shippingAmount ?? 0,
      tax_amount: input.taxAmount ?? 0,
      total: input.total,
      verified: input.verified,
      verified_by: input.verifiedBy ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id, order_number')
    .single()

  if (error || !order) {
    // UNIQUE(payment_reference) race: another request recorded it first.
    if (error?.code === '23505' && input.paymentReference) {
      const { data: raced } = await supabase
        .from('orders')
        .select('id, order_number')
        .eq('organization_id', input.orgId)
        .eq('payment_provider', input.paymentProvider ?? 'paypal')
        .eq('payment_reference', input.paymentReference)
        .maybeSingle()
      if (raced?.id) {
        return {
          id: raced.id as string,
          orderNumber: raced.order_number as string,
          matchedProducts: 0,
          unmatchedLines: [],
          duplicate: true,
        }
      }
    }
    console.error('[orders] insert failed:', error?.message)
    throw new IngestError('Unable to save order', 500)
  }

  const orderId = order.id as string
  const catalogue = await catalogueByName(supabase, input.orgId)
  const unmatched: string[] = []
  let matched = 0

  const rows = input.lines.map((line, i) => {
    const product = catalogue.get(line.name.trim().toLowerCase())
    if (product) matched++
    else unmatched.push(line.name)
    return {
      order_id: orderId,
      product_id: product?.id ?? null,
      sku: product?.sku ?? null,
      description: line.name,
      variant: line.variant || null,
      card: line.card || null,
      card_message: line.cardMessage || null,
      quantity: line.quantity,
      unit_price: line.unitAmount,
      total: Math.round(line.unitAmount * 100 * line.quantity) / 100,
      sort_order: i,
      _track: product?.track_stock ?? false,
      _productId: product?.id ?? null,
    }
  })

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(rows.map(({ _track, _productId, ...row }) => row))
  if (itemsError) console.error('[orders] items insert failed:', itemsError.message)

  // Only products the team has asked us to count move stock.
  const movements = rows
    .filter((r) => r._track && r._productId)
    .map((r) => ({
      organization_id: input.orgId,
      product_id: r._productId,
      delta: -r.quantity,
      reason: 'sold' as const,
      reference_type: 'order',
      reference_id: orderId,
      note: `${r.description}${r.variant ? ` · ${r.variant}` : ''} on ${orderNumber}`,
    }))
  if (movements.length) {
    const { error: movementError } = await supabase.from('inventory_movements').insert(movements)
    if (movementError) console.error('[orders] stock movement failed:', movementError.message)
  }

  return { id: orderId, orderNumber, matchedProducts: matched, unmatchedLines: unmatched, duplicate: false }
}

/** PayPal's shipping block, flattened to the shape orders.ship_to_address holds. */
export function normaliseAddress(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const pick = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)
  const out: Record<string, string> = {}
  const line1 = pick('address_line_1') ?? pick('line1')
  const line2 = pick('address_line_2') ?? pick('line2')
  const city = pick('admin_area_2') ?? pick('city')
  const state = pick('admin_area_1') ?? pick('state')
  const postal = pick('postal_code') ?? pick('zip')
  const country = pick('country_code') ?? pick('country')
  if (line1) out.line1 = line1
  if (line2) out.line2 = line2
  if (city) out.city = city
  if (state) out.state = state
  if (postal) out.postal_code = postal
  if (country) out.country = country
  return Object.keys(out).length ? out : null
}

/** "12 Main St, Apt 4, Fort Lee, NJ 07024, US" */
export function formatAddress(a: Record<string, string> | null | undefined): string {
  if (!a) return ''
  return [a.line1, a.line2, a.city, [a.state, a.postal_code].filter(Boolean).join(' '), a.country]
    .filter(Boolean)
    .join(', ')
}
