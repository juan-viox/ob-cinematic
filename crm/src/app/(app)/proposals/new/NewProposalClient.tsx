'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Plus, Trash2, Loader2, Save } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { DEFAULT_TERMS, DEFAULT_VALID_DAYS, computeTotals, lineTotal } from '@/lib/proposals'
import { addDays, toISODate, today } from '@/lib/occasions'
import { withBasePath } from '@/lib/url'

interface ProductLite {
  id: string; sku: string | null; name: string; description: string | null
  price: number; unit: string; price_note: string | null; category: string
}
interface ContactLite { id: string; first_name: string; last_name: string | null; email: string | null; company_id: string | null }
interface OccasionLite { id: string; title: string; occasion_date: string; quantity: number; contact_id: string | null; product_id: string | null }

interface Line { key: string; productId: string; description: string; details: string; quantity: number; unitPrice: number }

const CATEGORY_LABELS: Record<string, string> = {
  box: 'Gift boxes', tier: 'Corporate tiers', service: 'Services', plan: 'Concierge plans', addon: 'Add-ons', other: 'Other',
}

function newLine(): Line {
  return { key: crypto.randomUUID(), productId: '', description: '', details: '', quantity: 1, unitPrice: 0 }
}

export default function NewProposalClient({
  contacts, products, clientOccasions,
}: {
  contacts: ContactLite[]; products: ProductLite[]; clientOccasions: OccasionLite[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = createClient()

  const [contactId, setContactId] = useState(params.get('contact') ?? '')
  const [clientOccasionId, setClientOccasionId] = useState(params.get('occasion') ?? '')
  const [title, setTitle] = useState(params.get('title') ?? '')
  const [neededBy, setNeededBy] = useState(params.get('needed_by') ?? '')
  const [validUntil, setValidUntil] = useState(toISODate(addDays(today(), DEFAULT_VALID_DAYS)))
  const [intro, setIntro] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState(DEFAULT_TERMS)
  const [discount, setDiscount] = useState('0')
  const [shipping, setShipping] = useState('0')
  const [taxRate, setTaxRate] = useState('0')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const byCategory = useMemo(() => {
    const map = new Map<string, ProductLite[]>()
    for (const p of products) {
      const list = map.get(p.category) ?? []
      list.push(p)
      map.set(p.category, list)
    }
    return map
  }, [products])

  // Arriving from a calendar date: prefill the box, the count and the title.
  useEffect(() => {
    const productParam = params.get('product')
    const qtyParam = Number(params.get('quantity'))
    if (!productParam) return
    const p = products.find((x) => x.id === productParam)
    if (!p) return
    setLines([
      {
        key: crypto.randomUUID(),
        productId: p.id,
        description: p.name,
        details: p.description ?? '',
        quantity: Number.isFinite(qtyParam) && qtyParam > 0 ? qtyParam : 1,
        unitPrice: Number(p.price),
      },
    ])
    // Only on first render; the user owns the lines after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = computeTotals(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
    { discount: Number(discount) || 0, shipping: Number(shipping) || 0, taxRate: Number(taxRate) || 0 }
  )

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, ...patch }
        if (patch.productId !== undefined) {
          const p = products.find((x) => x.id === patch.productId)
          if (p) {
            next.description = p.name
            next.details = p.description ?? ''
            next.unitPrice = Number(p.price)
          }
        }
        return next
      })
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const filled = lines.filter((l) => l.description.trim())
    if (!title.trim()) { setError('Give the proposal a title the client will recognise'); return }
    if (filled.length === 0) { setError('Add at least one line'); return }

    setSaving(true)
    setError('')

    const contact = contacts.find((c) => c.id === contactId)

    // The number comes from a server-side counter, not from counting rows:
    // two people drafting at once must not both get PR-0007.
    let proposalNumber = ''
    try {
      const res = await fetch(withBasePath('/api/v1/proposals/number'), { method: 'POST' })
      const json = (await res.json()) as { number?: string; error?: string }
      if (!res.ok || !json.number) throw new Error(json.error ?? 'Could not allocate a proposal number')
      proposalNumber = json.number
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not allocate a proposal number')
      setSaving(false)
      return
    }

    const { data: proposal, error: insertError } = await supabase
      .from('proposals')
      .insert({
        proposal_number: proposalNumber,
        contact_id: contactId || null,
        company_id: contact?.company_id ?? null,
        client_occasion_id: clientOccasionId || null,
        title: title.trim(),
        status: 'draft',
        issue_date: toISODate(today()),
        valid_until: validUntil || null,
        needed_by: neededBy || null,
        intro: intro.trim() || null,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        subtotal: totals.subtotal,
        discount_amount: totals.discount,
        shipping_amount: totals.shipping,
        tax_rate: Number(taxRate) || 0,
        tax_amount: totals.tax,
        total: totals.total,
      })
      .select('id')
      .single()

    if (insertError || !proposal) { setError(insertError?.message ?? 'Could not save the proposal'); setSaving(false); return }

    const items = filled.map((l, i) => ({
      proposal_id: proposal.id,
      product_id: l.productId || null,
      description: l.description.trim(),
      details: l.details.trim() || null,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      total: lineTotal({ quantity: l.quantity, unitPrice: l.unitPrice }),
      sort_order: i,
    }))
    const { error: itemsError } = await supabase.from('proposal_items').insert(items)
    if (itemsError) { setError(itemsError.message); setSaving(false); return }

    if (clientOccasionId) {
      await supabase.from('client_occasions').update({ proposal_id: proposal.id, status: 'proposed' }).eq('id', clientOccasionId)
    }

    router.push(`/proposals/${proposal.id}`)
    router.refresh()
  }

  return (
    <div className="max-w-4xl">
      <Link href="/proposals" className="inline-flex items-center gap-1 text-sm mb-6 hover:underline" style={{ color: 'var(--muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Back to proposals
      </Link>

      <h1 className="text-2xl font-bold mb-6">New proposal</h1>

      <form onSubmit={handleSubmit}>
        {error && <div className="p-3 rounded-lg text-sm mb-4" style={{ background: 'rgba(225,112,85,0.1)', color: 'var(--danger)' }}>{error}</div>}

        <div className="card mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label>Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Holiday gifting for Northwest Critical Care" className="w-full" />
            </div>
            <div>
              <label>Client</label>
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="w-full">
                <option value="">No contact yet</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}{c.email ? ` · ${c.email}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Calendar date this covers</label>
              <select value={clientOccasionId} onChange={(e) => setClientOccasionId(e.target.value)} className="w-full">
                <option value="">Not on the calendar</option>
                {clientOccasions.map((o) => (
                  <option key={o.id} value={o.id}>{o.title} · {o.occasion_date}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Needed by</label>
              <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="w-full" />
            </div>
            <div>
              <label>Valid until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full" />
            </div>
            <div className="md:col-span-2">
              <label>Opening note</label>
              <textarea rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} className="w-full" placeholder="A line or two the client reads first." />
            </div>
          </div>
        </div>

        <div className="card mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">What we are proposing</h2>
            <button type="button" onClick={() => setLines((p) => [...p, newLine()])} className="btn btn-secondary text-sm">
              <Plus className="w-4 h-4" /> Add line
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-12 gap-3 items-start">
                <div className="col-span-12 md:col-span-3">
                  <select value={l.productId} onChange={(e) => updateLine(l.key, { productId: e.target.value })} className="w-full text-sm">
                    <option value="">Custom line</option>
                    {[...byCategory.entries()].map(([cat, list]) => (
                      <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
                        {list.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} · {formatCurrency(Number(p.price))}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="col-span-12 md:col-span-4">
                  <input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} className="w-full text-sm" placeholder="Description" />
                  <input value={l.details} onChange={(e) => updateLine(l.key, { details: e.target.value })} className="w-full text-sm mt-1.5" placeholder="Detail line (optional)" />
                </div>
                <div className="col-span-4 md:col-span-2">
                  <input type="number" min="1" step="1" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="w-full text-sm" />
                </div>
                <div className="col-span-5 md:col-span-2">
                  <input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: Number(e.target.value) || 0 })} className="w-full text-sm" />
                </div>
                <div className="col-span-3 md:col-span-1 flex items-center justify-end gap-1 pt-2">
                  <span className="text-sm font-medium tabular-nums">{formatCurrency(lineTotal({ quantity: l.quantity, unitPrice: l.unitPrice }))}</span>
                  <button
                    type="button"
                    onClick={() => setLines((p) => (p.length <= 1 ? p : p.filter((x) => x.key !== l.key)))}
                    disabled={lines.length <= 1}
                    className="p-1.5 rounded-md hover:bg-[var(--surface-2)]"
                    style={{ color: lines.length <= 1 ? 'var(--border)' : 'var(--danger)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card mb-4">
          <div className="max-w-sm ml-auto space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--muted)' }}>Subtotal</span>
              <span className="font-medium tabular-nums">{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm flex-1" style={{ color: 'var(--muted)' }}>Discount</span>
              <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-28 text-sm" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm flex-1" style={{ color: 'var(--muted)' }}>Shipping / delivery</span>
              <input type="number" min="0" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} className="w-28 text-sm" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm flex-1" style={{ color: 'var(--muted)' }}>Tax rate %</span>
              <input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="w-28 text-sm" />
              <span className="text-sm tabular-nums w-20 text-right">{formatCurrency(totals.tax)}</span>
            </div>
            <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className="font-semibold">Total</span>
              <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--accent-light)' }}>{formatCurrency(totals.total)}</span>
            </div>
          </div>
        </div>

        <div className="card mb-4 space-y-4">
          <div>
            <label>Notes for the client</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full" />
          </div>
          <div>
            <label>Terms</label>
            <textarea rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} className="w-full text-sm" />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Link href="/proposals" className="btn btn-secondary">Cancel</Link>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save draft
          </button>
        </div>
      </form>
    </div>
  )
}
