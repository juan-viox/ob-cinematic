'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Megaphone, CalendarClock, FileClock, UserPlus, Repeat, Snowflake,
  Mail, Phone, ArrowRight, CheckCircle2,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  approveBy, daysBetween, formatLongDate, fromISODate, nextOccurrence, toISODate, today,
} from '@/lib/occasions'
import type { Occasion } from '@/types'

interface ContactLite {
  id: string; first_name: string; last_name: string | null; email: string | null; phone: string | null
  status: string; source: string | null; created_at: string; company: { name: string } | null
}
interface ClientOccasionLite {
  id: string; title: string; occasion_date: string; status: string; quantity: number; budget: number | null
  contact_id: string | null; occasion_id: string | null; proposal_id: string | null
  contact: { id: string; first_name: string; last_name: string | null; email: string | null } | null
}
interface DealLite { id: string; title: string; amount: number; created_at: string; needed_by: string | null; contact_id: string | null; stage: { name: string; sort_order: number } | null }
interface OrderLite { id: string; order_number: string; placed_at: string; total: number; contact_id: string | null }
interface ProposalLite { id: string; proposal_number: string; title: string; status: string; sent_at: string | null; total: number; contact_id: string | null }
interface TemplateLite { id: string; name: string; subject: string; category: string }

interface Job {
  key: string
  kind: 'occasion' | 'proposal' | 'lead' | 'reorder' | 'holiday'
  urgency: number
  who: { id: string; name: string; email: string | null } | null
  headline: string
  detail: string
  when: string | null
  templateCategory: string
  action?: { label: string; href: string }
}

const KIND_META: Record<Job['kind'], { label: string; icon: typeof Mail; color: string }> = {
  occasion: { label: 'Date coming up', icon: CalendarClock, color: '#B8860B' },
  proposal: { label: 'Proposal waiting', icon: FileClock, color: '#6c5ce7' },
  lead: { label: 'Lead going cold', icon: UserPlus, color: '#e17055' },
  reorder: { label: 'Time to re-order', icon: Repeat, color: '#00b894' },
  holiday: { label: 'Holiday season', icon: Snowflake, color: '#74b9ff' },
}

export default function OutreachClient({
  occasions, clientOccasions, contacts, deals, orders, proposals, templates,
}: {
  occasions: Occasion[]
  clientOccasions: ClientOccasionLite[]
  contacts: ContactLite[]
  deals: DealLite[]
  orders: OrderLite[]
  proposals: ProposalLite[]
  templates: TemplateLite[]
}) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<'all' | Job['kind']>('all')
  const now = today()

  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts])
  const templateFor = (category: string) =>
    templates.find((t) => t.category === category) ?? templates.find((t) => t.category === 'follow-up') ?? templates[0]

  const jobs = useMemo<Job[]>(() => {
    const out: Job[] = []

    // 1. A client date whose approval deadline is inside three weeks.
    for (const c of clientOccasions) {
      const occasion = occasions.find((o) => o.id === c.occasion_id)
      const lead = occasion?.lead_time_days ?? 21
      const date = fromISODate(c.occasion_date)
      const approve = approveBy(date, lead)
      const daysToApprove = daysBetween(now, approve)
      if (daysToApprove > 21 || daysBetween(now, date) < 0) continue
      if (c.status === 'proposed' && c.proposal_id) continue
      out.push({
        key: `occ:${c.id}`,
        kind: 'occasion',
        urgency: daysToApprove,
        who: c.contact ? { id: c.contact.id, name: `${c.contact.first_name} ${c.contact.last_name ?? ''}`.trim(), email: c.contact.email } : null,
        headline: c.title,
        detail: `${c.quantity} box${c.quantity === 1 ? '' : 'es'}${c.budget ? ` at about ${formatCurrency(Number(c.budget))}` : ''} for ${formatLongDate(date)}. ${
          daysToApprove < 0 ? `Approval was due ${-daysToApprove} days ago.` : `Needs approval by ${toISODate(approve)}.`
        }`,
        when: c.occasion_date,
        templateCategory: 'reminder',
        action: { label: 'Draft proposal', href: `/proposals/new?occasion=${c.id}${c.contact_id ? `&contact=${c.contact_id}` : ''}&title=${encodeURIComponent(c.title)}&quantity=${c.quantity}&needed_by=${c.occasion_date}` },
      })
    }

    // 2. A proposal sent five days ago and still unanswered.
    for (const p of proposals) {
      if (!p.sent_at) continue
      const age = daysBetween(fromISODate(p.sent_at.slice(0, 10)), now)
      if (age < 5) continue
      const contact = p.contact_id ? contactsById.get(p.contact_id) : null
      out.push({
        key: `prop:${p.id}`,
        kind: 'proposal',
        urgency: -age,
        who: contact ? { id: contact.id, name: `${contact.first_name} ${contact.last_name ?? ''}`.trim(), email: contact.email } : null,
        headline: `${p.proposal_number} · ${p.title}`,
        detail: `${formatCurrency(Number(p.total))} sent ${age} days ago and ${p.status === 'viewed' ? 'opened but not answered' : 'not opened yet'}.`,
        when: p.sent_at,
        templateCategory: 'follow-up',
        action: { label: 'Open proposal', href: `/proposals/${p.id}` },
      })
    }

    // 3. A lead that came in over four days ago with no deal and no order.
    const contactsWithDeals = new Set(deals.map((d) => d.contact_id).filter(Boolean) as string[])
    const contactsWithOrders = new Set(orders.map((o) => o.contact_id).filter(Boolean) as string[])
    for (const c of contacts) {
      if (c.status !== 'lead') continue
      if (contactsWithDeals.has(c.id) || contactsWithOrders.has(c.id)) continue
      const age = daysBetween(fromISODate(c.created_at.slice(0, 10)), now)
      if (age < 4 || age > 120) continue
      out.push({
        key: `lead:${c.id}`,
        kind: 'lead',
        urgency: 10 - Math.min(age, 10),
        who: { id: c.id, name: `${c.first_name} ${c.last_name ?? ''}`.trim(), email: c.email },
        headline: `${c.first_name} ${c.last_name ?? ''}`.trim() || c.email || 'Unnamed lead',
        detail: `Came in ${age} days ago from ${c.source ?? 'the website'}${c.company?.name ? ` at ${c.company.name}` : ''} and has had nothing since.`,
        when: c.created_at,
        templateCategory: 'follow-up',
        action: { label: 'Open contact', href: `/contacts/${c.id}` },
      })
    }

    // 4. Someone who ordered about a year ago: the occasion is probably back.
    const lastOrderByContact = new Map<string, OrderLite>()
    for (const o of orders) {
      if (!o.contact_id) continue
      if (!lastOrderByContact.has(o.contact_id)) lastOrderByContact.set(o.contact_id, o)
    }
    for (const [contactId, order] of lastOrderByContact) {
      const age = daysBetween(fromISODate(order.placed_at.slice(0, 10)), now)
      if (age < 330 || age > 400) continue
      const contact = contactsById.get(contactId)
      if (!contact) continue
      out.push({
        key: `reorder:${order.id}`,
        kind: 'reorder',
        urgency: 20,
        who: { id: contact.id, name: `${contact.first_name} ${contact.last_name ?? ''}`.trim(), email: contact.email },
        headline: `${contact.first_name} ordered a year ago`,
        detail: `${order.order_number}, ${formatCurrency(Number(order.total))}, on ${formatDate(order.placed_at)}. If it was an annual occasion, it is coming round again.`,
        when: order.placed_at,
        templateCategory: 'follow-up',
        action: { label: 'Open contact', href: `/contacts/${contact.id}` },
      })
    }

    // 5. The holiday cutoff: one job, aimed at every business contact, while
    //    the mid-October deadline is between three weeks and a day away.
    const cutoff = occasions.find((o) => o.slug === 'holiday-booking-deadline')
    if (cutoff) {
      const date = nextOccurrence(cutoff, now)
      const days = date ? daysBetween(now, date) : null
      if (days !== null && days >= 0 && days <= 60) {
        out.push({
          key: 'holiday:cutoff',
          kind: 'holiday',
          urgency: -50,
          who: null,
          headline: `Holiday booking deadline in ${days} day${days === 1 ? '' : 's'}`,
          detail: 'Capacity is limited from mid October through December. Every corporate client who gifted last December should hear from us before this date.',
          when: date ? toISODate(date) : null,
          templateCategory: 'reminder',
          action: { label: 'See corporate contacts', href: '/contacts' },
        })
      }
    }

    return out.sort((a, b) => a.urgency - b.urgency)
  }, [clientOccasions, contacts, contactsById, deals, occasions, orders, proposals, now])

  const shown = jobs.filter((j) => (kind === 'all' || j.kind === kind) && !done.has(j.key))
  const counts = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.kind] = (acc[j.kind] ?? 0) + 1
    return acc
  }, {})

  function composeHref(job: Job): string {
    const t = templateFor(job.templateCategory)
    const params = new URLSearchParams()
    if (t) params.set('template', t.id)
    if (job.who) params.set('contact', job.who.id)
    return `/emails/compose?${params.toString()}`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Outreach</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Who to talk to today, and what to say. Worked out from the calendar, the pipeline and the orders.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button onClick={() => setKind('all')} className={`btn btn-sm ${kind === 'all' ? 'btn-primary' : 'btn-secondary'}`}>
          Everything ({jobs.length})
        </button>
        {(Object.keys(KIND_META) as Job['kind'][]).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`btn btn-sm ${kind === k ? 'btn-primary' : 'btn-secondary'}`} disabled={!counts[k]}>
            {KIND_META[k].label} ({counts[k] ?? 0})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card text-center py-16">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--success)' }} />
          <h3 className="text-lg font-semibold mb-1">Nothing is waiting on you</h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Every date is proposed, every proposal answered and no lead has gone quiet. Add dates on the{' '}
            <Link href="/occasions" className="hover:underline" style={{ color: 'var(--accent-light)' }}>gifting calendar</Link> to keep it that way.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((job) => {
            const meta = KIND_META[job.kind]
            return (
              <div key={job.key} className="card">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-lg shrink-0" style={{ background: `${meta.color}1a` }}>
                    <meta.icon className="w-5 h-5" style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{job.headline}</h3>
                          <span className="badge badge-neutral text-[10px]">{meta.label}</span>
                        </div>
                        {job.who && (
                          <p className="text-sm mt-0.5">
                            <Link href={`/contacts/${job.who.id}`} className="hover:underline" style={{ color: 'var(--accent-light)' }}>
                              {job.who.name}
                            </Link>
                            {job.who.email && <span style={{ color: 'var(--muted)' }}> · {job.who.email}</span>}
                          </p>
                        )}
                        <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>{job.detail}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {job.who?.email && (
                        <Link href={composeHref(job)} className="btn btn-primary btn-sm">
                          <Mail className="w-3.5 h-3.5" /> Write to them
                        </Link>
                      )}
                      {job.action && (
                        <Link href={job.action.href} className="btn btn-secondary btn-sm">
                          {job.action.label} <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                      {job.who && !job.who.email && (
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                          <Phone className="w-3.5 h-3.5" /> No email on file: call instead
                        </span>
                      )}
                      <button
                        onClick={() => setDone((prev) => new Set(prev).add(job.key))}
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--muted)' }}
                      >
                        Not now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs mt-6 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
        <Megaphone className="w-3.5 h-3.5" />
        &ldquo;Not now&rdquo; hides a job until you reload. Nothing here is stored, so the list is always the truth as of this moment.
      </p>
    </div>
  )
}
