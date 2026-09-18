/** Shared proposal maths and labels (client and server). */

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired'

export const PROPOSAL_STATUS_STYLES: Record<ProposalStatus, { label: string; bg: string; color: string }> = {
  draft: { label: 'Draft', bg: 'rgba(136,136,160,0.15)', color: 'var(--muted)' },
  sent: { label: 'Sent', bg: 'rgba(108,92,231,0.15)', color: 'var(--accent-light)' },
  viewed: { label: 'Viewed', bg: 'rgba(116,185,255,0.15)', color: 'var(--info)' },
  accepted: { label: 'Accepted', bg: 'rgba(0,184,148,0.15)', color: 'var(--success)' },
  declined: { label: 'Declined', bg: 'rgba(225,112,85,0.15)', color: 'var(--danger)' },
  expired: { label: 'Expired', bg: 'rgba(136,136,160,0.1)', color: 'var(--muted)' },
}

export interface LineLike {
  quantity: number
  unitPrice: number
}

/** Money adds up in cents; 132.00 × 3 in floats does not. */
export function cents(n: number): number {
  return Math.round((Number(n) || 0) * 100)
}

export function lineTotal(line: LineLike): number {
  return (cents(line.unitPrice) * (Number(line.quantity) || 0)) / 100
}

export function computeTotals(
  lines: LineLike[],
  opts: { discount?: number; shipping?: number; taxRate?: number } = {}
) {
  const subtotalCents = lines.reduce((sum, l) => sum + cents(line_total_cents(l)), 0)
  const discountCents = Math.min(cents(opts.discount ?? 0), subtotalCents)
  const shippingCents = cents(opts.shipping ?? 0)
  const taxable = subtotalCents - discountCents + shippingCents
  const taxCents = Math.round((taxable * (Number(opts.taxRate) || 0)) / 100)
  const totalCents = taxable + taxCents
  return {
    subtotal: subtotalCents / 100,
    discount: discountCents / 100,
    shipping: shippingCents / 100,
    tax: taxCents / 100,
    total: totalCents / 100,
  }
}

function line_total_cents(l: LineLike): number {
  return lineTotal(l)
}

export const DEFAULT_TERMS = `Prices are per box unless stated and exclude sales tax. Shipping, delivery and any design fee are shown above.

Orders under $5,000 are billed in full on approval; larger orders are billed 50% on approval and 50% before shipping. The lead-time clock starts once this proposal is approved, payment has cleared and the recipient list, artwork and note copy are final.

Standard lead time is 2 to 4 weeks from approval (3 to 4 weeks for orders shipping 15 October to 31 December), plus 1 to 7 business days in transit. Custom, corporate and event orders can be changed or cancelled without charge until the final proposal is approved and sourcing begins.`

export const DEFAULT_VALID_DAYS = 14
