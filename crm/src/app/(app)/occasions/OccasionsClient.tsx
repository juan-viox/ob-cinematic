'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  CalendarDays, CalendarClock, Plus, X, Save, Loader2, AlertTriangle,
  Gift, Users, Repeat, FileText,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import {
  CLIENT_OCCASION_STATUSES, OCCASION_CATEGORIES, approveBy, daysBetween,
  describeRule, formatLongDate, fromISODate, nextOccurrence, toISODate, today,
} from '@/lib/occasions'
import type { ClientOccasion, ClientOccasionStatus, Occasion } from '@/types'

interface ProductLite { id: string; name: string; price: number; sku: string | null; category: string }
interface ContactLite { id: string; first_name: string; last_name: string | null; email: string | null; company_id: string | null }

export default function OccasionsClient({
  occasions,
  clientOccasions: initialClient,
  contacts,
  products,
}: {
  occasions: Occasion[]
  clientOccasions: ClientOccasion[]
  contacts: ContactLite[]
  products: ProductLite[]
}) {
  const [clientOccasions, setClientOccasions] = useState(initialClient)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [horizon, setHorizon] = useState(120)
  const router = useRouter()
  const supabase = createClient()

  const now = today()
  const bySku = useMemo(() => new Map(products.filter((p) => p.sku).map((p) => [p.sku as string, p])), [products])

  // Form
  const [form, setForm] = useState({
    contact_id: '',
    occasion_id: '',
    title: '',
    occasion_date: '',
    quantity: '1',
    budget: '',
    product_id: '',
    recipient_name: '',
    recurs_annually: false,
    notes: '',
  })

  const calendar = useMemo(
    () =>
      occasions
        .filter((o) => o.is_active)
        .map((o) => {
          const date = nextOccurrence(o, now)
          return { occasion: o, date, days: date ? daysBetween(now, date) : null }
        })
        .sort((a, b) => {
          if (a.days === null) return 1
          if (b.days === null) return -1
          return a.days - b.days
        }),
    [occasions, now]
  )

  const upcomingClient = useMemo(
    () =>
      clientOccasions
        .map((c) => ({ ...c, days: daysBetween(now, fromISODate(c.occasion_date)) }))
        .filter((c) => c.days >= -14 && c.days <= horizon)
        .sort((a, b) => a.days - b.days),
    [clientOccasions, horizon, now]
  )

  const needsAction = upcomingClient.filter((c) => {
    const occasion = occasions.find((o) => o.id === c.occasion_id)
    const lead = occasion?.lead_time_days ?? 21
    return ['planned', 'proposed'].includes(c.status) && daysBetween(now, approveBy(fromISODate(c.occasion_date), lead)) <= 14
  })

  async function addClientOccasion(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.occasion_date) { setError('A title and a date are required'); return }
    setSaving(true)
    setError('')
    const contact = contacts.find((c) => c.id === form.contact_id)
    const { data, error: err } = await supabase
      .from('client_occasions')
      .insert({
        contact_id: form.contact_id || null,
        company_id: contact?.company_id ?? null,
        occasion_id: form.occasion_id || null,
        title: form.title.trim(),
        occasion_date: form.occasion_date,
        quantity: Math.max(1, Math.round(Number(form.quantity) || 1)),
        budget: form.budget === '' ? null : Number(form.budget),
        product_id: form.product_id || null,
        recipient_name: form.recipient_name.trim() || null,
        recurs_annually: form.recurs_annually,
        notes: form.notes.trim() || null,
        status: 'planned',
      })
      .select(
        'id, title, occasion_date, status, quantity, budget, recipient_name, ship_to, notes, recurs_annually, contact_id, company_id, occasion_id, product_id, proposal_id, deal_id, contact:contacts(id, first_name, last_name, email, phone), company:companies(id, name), product:products(id, name, price, sku)'
      )
      .single()
    if (err) { setError(err.message); setSaving(false); return }
    setClientOccasions((prev) => [...prev, data as unknown as ClientOccasion])
    setShowForm(false)
    setSaving(false)
    setForm({ contact_id: '', occasion_id: '', title: '', occasion_date: '', quantity: '1', budget: '', product_id: '', recipient_name: '', recurs_annually: false, notes: '' })
  }

  async function setStatus(id: string, status: ClientOccasionStatus) {
    const { error: err } = await supabase.from('client_occasions').update({ status }).eq('id', id)
    if (err) { setError(err.message); return }
    setClientOccasions((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
  }

  function proposeFor(c: ClientOccasion) {
    const params = new URLSearchParams()
    if (c.contact_id) params.set('contact', c.contact_id)
    params.set('occasion', c.id)
    params.set('title', c.title)
    if (c.product_id) params.set('product', c.product_id)
    params.set('quantity', String(c.quantity))
    params.set('needed_by', c.occasion_date)
    router.push(`/proposals/new?${params.toString()}`)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Gifting calendar</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Every occasion we gift for, and every date we are holding for a client
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn btn-primary">
          <Plus className="w-4 h-4" /> Add a client date
        </button>
      </div>

      {error && <div className="p-3 rounded-lg text-sm mb-4" style={{ background: 'rgba(225,112,85,0.1)', color: 'var(--danger)' }}>{error}</div>}

      {needsAction.length > 0 && (
        <div className="card mb-6" style={{ borderColor: 'rgba(253,203,110,0.35)', background: 'rgba(253,203,110,0.06)' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
            <div className="flex-1">
              <p className="font-semibold mb-2">
                {needsAction.length} date{needsAction.length === 1 ? '' : 's'} needing a proposal now
              </p>
              <div className="space-y-1.5">
                {needsAction.slice(0, 5).map((c) => (
                  <div key={c.id} className="text-sm flex items-center justify-between gap-3 flex-wrap">
                    <span>
                      <span className="font-medium">{c.title}</span>
                      {c.contact && <span style={{ color: 'var(--muted)' }}> · {c.contact.first_name} {c.contact.last_name}</span>}
                      <span style={{ color: 'var(--muted)' }}> · {formatLongDate(fromISODate(c.occasion_date))}</span>
                    </span>
                    <button onClick={() => proposeFor(c)} className="btn btn-sm btn-secondary">
                      <FileText className="w-3.5 h-3.5" /> Propose
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Client dates */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--muted)' }}>
              <Users className="w-4 h-4" /> Client dates
            </h2>
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="text-xs w-36">
              <option value={60}>Next 60 days</option>
              <option value={120}>Next 120 days</option>
              <option value={365}>Next year</option>
            </select>
          </div>

          {upcomingClient.length === 0 ? (
            <div className="card text-center py-10" style={{ color: 'var(--muted)' }}>
              <CalendarClock className="w-7 h-7 mx-auto mb-2" />
              <p className="text-sm">No client dates in this window.</p>
              <p className="text-xs mt-1">Add birthdays, closings and work anniversaries as you learn them.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingClient.map((c) => {
                const occasion = occasions.find((o) => o.id === c.occasion_id)
                const lead = occasion?.lead_time_days ?? 21
                const approve = approveBy(fromISODate(c.occasion_date), lead)
                const daysToApprove = daysBetween(now, approve)
                const s = CLIENT_OCCASION_STATUSES[c.status] ?? CLIENT_OCCASION_STATUSES.planned
                const late = daysToApprove < 0 && ['planned', 'proposed'].includes(c.status)
                return (
                  <div key={c.id} className="card">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{c.title}</h3>
                          <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                          {c.recurs_annually && <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />}
                        </div>
                        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                          {c.contact ? (
                            <Link href={`/contacts/${c.contact.id}`} className="hover:underline">
                              {c.contact.first_name} {c.contact.last_name}
                            </Link>
                          ) : c.company?.name ?? 'No contact'}
                          {c.recipient_name ? ` · for ${c.recipient_name}` : ''}
                          {` · ${c.quantity} box${c.quantity === 1 ? '' : 'es'}`}
                          {c.budget ? ` · ${formatCurrency(Number(c.budget))} each` : ''}
                        </p>
                        <p className="text-xs mt-1">
                          <span style={{ color: 'var(--muted)' }}>{formatLongDate(fromISODate(c.occasion_date))}</span>
                          {' · '}
                          <span style={{ color: late ? 'var(--danger)' : daysToApprove <= 14 ? 'var(--warning)' : 'var(--muted)' }}>
                            {late
                              ? `approval was due ${-daysToApprove} day${-daysToApprove === 1 ? '' : 's'} ago`
                              : `approve by ${toISODate(approve)}`}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {['planned', 'proposed'].includes(c.status) && (
                          <button onClick={() => proposeFor(c)} className="btn btn-sm btn-secondary" title="Draft a proposal for this date">
                            <FileText className="w-3.5 h-3.5" /> Propose
                          </button>
                        )}
                        <select
                          value={c.status}
                          onChange={(e) => setStatus(c.id, e.target.value as ClientOccasionStatus)}
                          className="text-xs w-36"
                        >
                          {Object.entries(CLIENT_OCCASION_STATUSES).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* The master calendar */}
        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
            <CalendarDays className="w-4 h-4" /> The year, and when to start
          </h2>
          <div className="space-y-2">
            {calendar.map(({ occasion: o, date, days }) => {
              const cat = OCCASION_CATEGORIES[o.category] ?? OCCASION_CATEGORIES.holiday
              const approve = date ? approveBy(date, o.lead_time_days) : null
              const startNow = approve ? daysBetween(now, approve) <= 21 : false
              return (
                <div key={o.id} className="card" style={{ opacity: date ? 1 : 0.7 }}>
                  <div className="flex items-start gap-3">
                    <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: cat.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm">{o.name}</h3>
                        <span className="text-xs shrink-0" style={{ color: startNow ? 'var(--warning)' : 'var(--muted)' }}>
                          {date ? `${formatLongDate(date)} · ${days} day${days === 1 ? '' : 's'}` : 'per client'}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {describeRule(o)}
                        {approve && ` · approve by ${toISODate(approve)}`}
                      </p>
                      {o.talking_points && <p className="text-xs mt-1.5">{o.talking_points}</p>}
                      {o.suggested_skus.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <Gift className="w-3 h-3" style={{ color: 'var(--muted)' }} />
                          {o.suggested_skus.map((sku) => {
                            const p = bySku.get(sku)
                            return p ? (
                              <span key={sku} className="badge badge-neutral text-[10px]">
                                {p.name} {formatCurrency(Number(p.price))}
                              </span>
                            ) : null
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-content w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">Add a client date</h2>
              <button onClick={() => setShowForm(false)} className="btn btn-ghost btn-icon btn-sm"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={addClientOccasion} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label>Client</label>
                  <select value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
                    <option value="">No contact yet</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Occasion</label>
                  <select
                    value={form.occasion_id}
                    onChange={(e) => {
                      const o = occasions.find((x) => x.id === e.target.value)
                      const next = o ? nextOccurrence(o, now) : null
                      setForm({
                        ...form,
                        occasion_id: e.target.value,
                        title: form.title || (o?.name ?? ''),
                        occasion_date: form.occasion_date || (next ? toISODate(next) : ''),
                      })
                    }}
                  >
                    <option value="">Something else</option>
                    {occasions.filter((o) => o.is_active).map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label>What is it *</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Closing gift for the Alvarado family" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label>Date *</label>
                  <input type="date" value={form.occasion_date} onChange={(e) => setForm({ ...form, occasion_date: e.target.value })} required />
                </div>
                <div>
                  <label>Recipient</label>
                  <input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} placeholder="Who opens the box" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label>Boxes</label>
                  <input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </div>
                <div>
                  <label>Budget each</label>
                  <input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
                </div>
                <div>
                  <label>Box</label>
                  <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                    <option value="">Decide later</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferences, allergies, anything to remember" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.recurs_annually} onChange={(e) => setForm({ ...form, recurs_annually: e.target.checked })} />
                This comes round every year
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
