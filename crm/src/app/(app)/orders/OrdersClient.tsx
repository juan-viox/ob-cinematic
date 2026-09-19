'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ShoppingBag, Search, Truck, CheckCircle2, AlertTriangle, PackageCheck,
  Loader2, ExternalLink, MapPin, MessageSquare,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { formatAddress } from '@/lib/orders'
import EmptyState from '@/components/shared/EmptyState'
import type { Order, OrderFulfillmentStatus } from '@/types'

const FULFILLMENT: { key: OrderFulfillmentStatus; label: string; color: string; bg: string }[] = [
  { key: 'new', label: 'New', color: 'var(--accent-light)', bg: 'rgba(108,92,231,0.15)' },
  { key: 'confirmed', label: 'Confirmed', color: '#DAA520', bg: 'rgba(218,165,32,0.18)' },
  { key: 'packing', label: 'Packing', color: '#CD853F', bg: 'rgba(205,133,63,0.18)' },
  { key: 'shipped', label: 'Shipped', color: 'var(--info)', bg: 'rgba(116,185,255,0.15)' },
  { key: 'delivered', label: 'Delivered', color: 'var(--success)', bg: 'rgba(0,184,148,0.15)' },
  { key: 'on_hold', label: 'On hold', color: 'var(--warning)', bg: 'rgba(253,203,110,0.15)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--muted)', bg: 'rgba(136,136,160,0.12)' },
]

const PAYMENT_LABEL: Record<string, { label: string; color: string }> = {
  paid: { label: 'Paid', color: 'var(--success)' },
  unverified: { label: 'Unverified', color: 'var(--warning)' },
  pending: { label: 'Pending', color: 'var(--muted)' },
  partially_paid: { label: 'Part paid', color: 'var(--warning)' },
  refunded: { label: 'Refunded', color: 'var(--muted)' },
  cancelled: { label: 'Cancelled', color: 'var(--muted)' },
}

export default function OrdersClient({ orders: initial }: { orders: Order[] }) {
  const [orders, setOrders] = useState(initial)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'open' | 'all' | OrderFulfillmentStatus>('open')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tracking, setTracking] = useState<Record<string, { carrier: string; number: string }>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [texting, setTexting] = useState<string | null>(null)
  const [sent, setSent] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () =>
      orders.filter((o) => {
        const matchesFilter =
          filter === 'all'
            ? true
            : filter === 'open'
              ? !['delivered', 'cancelled'].includes(o.fulfillment_status)
              : o.fulfillment_status === filter
        if (!matchesFilter) return false
        if (!q) return true
        const who = `${o.payer_name ?? ''} ${o.payer_email ?? ''} ${o.contact?.first_name ?? ''} ${o.contact?.last_name ?? ''}`
        const what = (o.items ?? []).map((i) => i.description).join(' ')
        return `${o.order_number} ${who} ${what} ${o.tracking_number ?? ''}`.toLowerCase().includes(q)
      }),
    [orders, filter, q]
  )

  const revenue = orders.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + Number(o.total), 0)
  const toPack = orders.filter((o) => ['new', 'confirmed', 'packing'].includes(o.fulfillment_status)).length
  const unverified = orders.filter((o) => !o.verified && o.payment_status !== 'cancelled').length

  async function setStatus(order: Order, status: OrderFulfillmentStatus) {
    setBusy(order.id)
    setError('')
    /* The move goes through the API rather than straight to the database,
       because confirming, shipping and delivering also text the customer and
       the Twilio credentials must never reach a browser. */
    const t = tracking[order.id]
    let res: Response
    try {
      res = await fetch(`/api/v1/orders/${order.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, carrier: t?.carrier ?? null, trackingNumber: t?.number ?? null }),
      })
    } catch {
      setError('Could not reach the server. Try again.')
      setBusy(null)
      return
    }
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; carrier?: string | null; trackingNumber?: string | null; sms?: { sent: boolean; reason?: string } | null }
      | null
    if (!res.ok || !data?.ok) {
      setError(data?.error ?? 'Could not update the order')
      setBusy(null)
      return
    }

    const patch: Partial<Order> = { fulfillment_status: status }
    if (status === 'shipped') {
      patch.shipped_at = new Date().toISOString()
      patch.carrier = data.carrier ?? order.carrier
      patch.tracking_number = data.trackingNumber ?? order.tracking_number
    }
    if (status === 'delivered') patch.delivered_at = new Date().toISOString()
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, ...patch } : o)))

    /* Say plainly when the customer was not texted. Silence here would read
       as "they know", and they would not. */
    if (data.sms && !data.sms.sent) {
      const why =
        data.sms.reason === 'opted_out' ? 'they asked us to stop texting'
        : data.sms.reason === 'no_number' ? 'there is no mobile number on the order'
        : data.sms.reason === 'not_configured' ? 'texting is not set up yet'
        : 'the message could not be sent'
      setError(`Order updated, but the customer was not texted: ${why}.`)
    }
    setBusy(null)
  }

  /* A text in their own words, for everything the milestones do not cover:
     a delay, a question about the card, a box that went out early. */
  async function textCustomer(order: Order) {
    const message = (note[order.id] ?? '').trim()
    if (!message) return
    setTexting(order.id)
    setError('')
    let res: Response
    try {
      res = await fetch(`/api/v1/orders/${order.id}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
    } catch {
      setError('Could not reach the server. Try again.')
      setTexting(null)
      return
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !data?.ok) {
      setError(data?.error ?? 'The message could not be sent')
      setTexting(null)
      return
    }
    setNote({ ...note, [order.id]: '' })
    setSent({ ...sent, [order.id]: 'Sent.' })
    setTexting(null)
  }

  if (orders.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Orders</h1>
        <EmptyState
          icon={ShoppingBag}
          title="No orders yet"
          description="Every checkout on occasionsbox.com lands here with its line items, the shipping address and what it took off the shelf."
        />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Everything bought on the website, with what to pack and where it goes
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order, name or box..." className="w-full pl-10" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(0,184,148,0.15)' }}><CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} /></div>
          <div><p className="text-sm" style={{ color: 'var(--muted)' }}>Paid</p><p className="text-2xl font-bold">{formatCurrency(revenue)}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(205,133,63,0.18)' }}><PackageCheck className="w-5 h-5" style={{ color: '#CD853F' }} /></div>
          <div><p className="text-sm" style={{ color: 'var(--muted)' }}>To pack and ship</p><p className="text-2xl font-bold">{toPack}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(253,203,110,0.15)' }}><AlertTriangle className="w-5 h-5" style={{ color: 'var(--warning)' }} /></div>
          <div><p className="text-sm" style={{ color: 'var(--muted)' }}>Need checking with the processor</p><p className="text-2xl font-bold">{unverified}</p></div>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg text-sm mb-4" style={{ background: 'rgba(225,112,85,0.1)', color: 'var(--danger)' }}>{error}</div>}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['open', 'all', ...FULFILLMENT.map((f) => f.key)] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`}
          >
            {k === 'open' ? 'Open' : k === 'all' ? 'All' : FULFILLMENT.find((f) => f.key === k)!.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((o) => {
          const f = FULFILLMENT.find((x) => x.key === o.fulfillment_status) ?? FULFILLMENT[0]
          const pay = PAYMENT_LABEL[o.payment_status] ?? PAYMENT_LABEL.pending
          const address = formatAddress(o.ship_to_address)
          const isOpen = open === o.id
          const units = (o.items ?? []).reduce((s, i) => s + i.quantity, 0)
          return (
            <div key={o.id} className="card">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setOpen(isOpen ? null : o.id)} className="font-semibold hover:underline" style={{ color: 'var(--accent-light)' }}>
                      {o.order_number}
                    </button>
                    <span className="badge" style={{ background: f.bg, color: f.color }}>{f.label}</span>
                    <span className="badge badge-neutral" style={{ color: pay.color }}>{pay.label}</span>
                    {!o.verified && (
                      <span className="badge text-[10px]" style={{ background: 'rgba(253,203,110,0.15)', color: 'var(--warning)' }}>
                        confirm in PayPal
                      </span>
                    )}
                  </div>
                  <p className="text-sm mt-1">
                    {o.contact ? (
                      <Link href={`/contacts/${o.contact.id}`} className="hover:underline">
                        {o.contact.first_name} {o.contact.last_name}
                      </Link>
                    ) : (
                      o.payer_name || 'Guest'
                    )}
                    {o.payer_email && <span style={{ color: 'var(--muted)' }}> · {o.payer_email}</span>}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {formatDate(o.placed_at)} · {units} box{units === 1 ? '' : 'es'} ·{' '}
                    {(o.items ?? []).map((i) => `${i.description}${i.variant ? ` · ${i.variant}` : ''} ×${i.quantity}`).join(', ')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-bold" style={{ color: 'var(--accent-light)' }}>{formatCurrency(Number(o.total))}</div>
                  {o.needed_by && <div className="text-xs" style={{ color: 'var(--warning)' }}>needed by {formatDate(o.needed_by)}</div>}
                </div>
              </div>

              {isOpen && (
                <div className="mt-4 pt-4 border-t grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ borderColor: 'var(--border)' }}>
                  <div className="lg:col-span-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Packing list</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        {(o.items ?? []).map((i) => (
                          <tr key={i.id}>
                            <td className="py-1.5 font-medium">
                              {i.description}
                              {i.variant && <span style={{ color: 'var(--muted)' }}> · {i.variant}</span>}
                              {!i.sku && <span className="badge badge-neutral text-[10px] ml-2">not in catalogue</span>}
                              {(i.card || i.card_message) && (
                                <div className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--muted)' }}>
                                  <span className="uppercase tracking-wider text-[10px]">Card</span>{' '}
                                  {i.card || 'not chosen'}
                                  {i.card_message && (
                                    <div className="mt-0.5 italic" style={{ color: 'var(--text)' }}>
                                      &ldquo;{i.card_message}&rdquo;
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums" style={{ color: 'var(--muted)' }}>×{i.quantity}</td>
                            <td className="py-1.5 text-right tabular-nums font-medium">{formatCurrency(Number(i.total))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {o.notes && (
                      <pre className="text-xs mt-3 whitespace-pre-wrap font-sans p-3 rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>{o.notes}</pre>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                        <MapPin className="w-3.5 h-3.5" /> Ship to
                      </h4>
                      {address ? (
                        <p className="text-sm">
                          {o.ship_to_name && <span className="font-medium">{o.ship_to_name}<br /></span>}
                          <span style={{ color: 'var(--muted)' }}>{address}</span>
                        </p>
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>No address came with the payment. Ask the buyer before packing.</p>
                      )}
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Move it along</h4>
                      {o.fulfillment_status === 'shipped' || o.fulfillment_status === 'delivered' ? (
                        <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
                          {o.carrier ?? 'Carrier'} {o.tracking_number ?? ''}
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input
                            placeholder="Carrier"
                            value={tracking[o.id]?.carrier ?? ''}
                            onChange={(e) => setTracking({ ...tracking, [o.id]: { carrier: e.target.value, number: tracking[o.id]?.number ?? '' } })}
                            className="text-sm"
                          />
                          <input
                            placeholder="Tracking number"
                            value={tracking[o.id]?.number ?? ''}
                            onChange={(e) => setTracking({ ...tracking, [o.id]: { carrier: tracking[o.id]?.carrier ?? '', number: e.target.value } })}
                            className="text-sm"
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {FULFILLMENT.filter((s) => s.key !== o.fulfillment_status).slice(0, 5).map((s) => (
                          <button
                            key={s.key}
                            onClick={() => setStatus(o, s.key)}
                            disabled={busy === o.id}
                            className="btn btn-secondary btn-sm"
                          >
                            {busy === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : s.key === 'shipped' ? <Truck className="w-3.5 h-3.5" /> : null}
                            {s.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Text the customer</h4>
                        {o.payer_phone ? (
                          <>
                            <div className="flex gap-2">
                              <input
                                placeholder="Anything they should know…"
                                maxLength={300}
                                value={note[o.id] ?? ''}
                                onChange={(e) => { setNote({ ...note, [o.id]: e.target.value }); setSent({ ...sent, [o.id]: '' }) }}
                                className="text-sm"
                              />
                              <button
                                onClick={() => textCustomer(o)}
                                disabled={texting === o.id || !(note[o.id] ?? '').trim()}
                                className="btn btn-secondary btn-sm whitespace-nowrap"
                              >
                                {texting === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                                Send
                              </button>
                            </div>
                            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                              {sent[o.id] ? sent[o.id] : `Goes to ${o.payer_phone}. Confirming, shipping and delivering already text them.`}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm" style={{ color: 'var(--muted)' }}>No mobile number came with this order, so there is nobody to text.</p>
                        )}
                      </div>
                    </div>

                    {o.payment_reference && (
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        {o.payment_provider === 'stripe' ? 'Stripe' : 'PayPal'} {o.payment_reference}
                        {(o.payment_provider === 'paypal' || o.payment_provider === 'stripe') && (
                          <a
                            href={
                              o.payment_provider === 'stripe'
                                ? `https://dashboard.stripe.com/payments/${o.payment_reference}`
                                : `https://www.paypal.com/activity/payment/${o.payment_reference}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 ml-2 hover:underline"
                            style={{ color: 'var(--accent-light)' }}
                          >
                            open <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {shown.length === 0 && (
          <div className="card text-center py-12" style={{ color: 'var(--muted)' }}>No orders match that filter.</div>
        )}
      </div>
    </div>
  )
}
