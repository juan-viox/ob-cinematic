'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft, Send, CheckCircle2, XCircle, Loader2, Printer, Link2, Copy,
  Mail, FileText, Check,
} from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PROPOSAL_STATUS_STYLES } from '@/lib/proposals'
import { withBasePath } from '@/lib/url'
import type { Proposal, ProposalItem } from '@/types'

export default function ProposalDetailClient({
  proposal: initial,
  items,
}: {
  proposal: Proposal
  items: ProposalItem[]
}) {
  const [proposal, setProposal] = useState(initial)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const s = PROPOSAL_STATUS_STYLES[proposal.status]
  const publicPath = `/p/${proposal.public_token}`
  const publicUrl = typeof window === 'undefined' ? publicPath : `${window.location.origin}${withBasePath(publicPath)}`

  async function setStatus(status: Proposal['status'], extra: Record<string, unknown> = {}) {
    setBusy(status)
    setError('')
    const patch: Record<string, unknown> = { status, ...extra }
    if (status === 'sent' && !proposal.sent_at) patch.sent_at = new Date().toISOString()
    if (status === 'accepted') patch.accepted_at = new Date().toISOString()
    if (status === 'declined') patch.declined_at = new Date().toISOString()
    const { error: err } = await supabase.from('proposals').update(patch).eq('id', proposal.id)
    if (err) { setError(err.message); setBusy(''); return }
    setProposal((p) => ({ ...p, ...(patch as Partial<Proposal>) }))

    // An approved proposal moves the calendar date and the deal along with it.
    if (status === 'accepted') {
      if (proposal.client_occasion_id) {
        await supabase.from('client_occasions').update({ status: 'approved' }).eq('id', proposal.client_occasion_id)
      }
      await supabase.from('activities').insert({
        contact_id: proposal.contact_id ?? null,
        deal_id: proposal.deal_id ?? null,
        type: 'note',
        title: `Proposal ${proposal.proposal_number} approved`,
        description: `${proposal.title} — ${formatCurrency(Number(proposal.total))}`,
        status: 'completed',
        completed_at: new Date().toISOString(),
        metadata: { proposal_id: proposal.id },
      })
    }
    setBusy('')
    router.refresh()
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the link and copy it by hand.')
    }
  }

  async function emailIt() {
    if (!proposal.contact?.email) { setError('This client has no email address on file.'); return }
    setBusy('email')
    setError('')
    const res = await fetch(withBasePath(`/api/v1/proposals/${proposal.id}/send`), { method: 'POST' })
    const json = (await res.json().catch(() => ({}))) as { error?: string; sent?: boolean; message?: string }
    if (!res.ok) { setError(json.error ?? 'Could not send'); setBusy(''); return }
    setProposal((p) => ({ ...p, status: 'sent', sent_at: new Date().toISOString() }))
    setBusy('')
    router.refresh()
  }

  return (
    <div className="max-w-4xl">
      <Link href="/proposals" className="inline-flex items-center gap-1 text-sm mb-6 hover:underline" style={{ color: 'var(--muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Back to proposals
      </Link>

      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{proposal.proposal_number}</h1>
          <p className="text-sm mt-1">{proposal.title}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
            {proposal.sent_at && <span className="text-xs" style={{ color: 'var(--muted)' }}>sent {formatDate(proposal.sent_at)}</span>}
            {proposal.viewed_at && <span className="text-xs" style={{ color: 'var(--info)' }}>opened {formatDate(proposal.viewed_at)}</span>}
            {proposal.accepted_at && <span className="text-xs" style={{ color: 'var(--success)' }}>approved {formatDate(proposal.accepted_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {proposal.status === 'draft' && (
            <button onClick={() => setStatus('sent')} disabled={busy !== ''} className="btn btn-secondary">
              {busy === 'sent' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mark as sent
            </button>
          )}
          <button onClick={emailIt} disabled={busy !== ''} className="btn btn-primary">
            {busy === 'email' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Email to client
          </button>
          <a href={withBasePath(`/api/v1/proposals/${proposal.id}/print`)} target="_blank" rel="noreferrer" className="btn btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </a>
          {!['accepted', 'declined'].includes(proposal.status) && (
            <>
              <button onClick={() => setStatus('accepted', { accepted_by_name: 'Recorded by the team' })} disabled={busy !== ''} className="btn btn-secondary" style={{ color: 'var(--success)' }}>
                <CheckCircle2 className="w-4 h-4" /> Mark approved
              </button>
              <button onClick={() => setStatus('declined')} disabled={busy !== ''} className="btn btn-secondary">
                <XCircle className="w-4 h-4" /> Declined
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg text-sm mb-4" style={{ background: 'rgba(225,112,85,0.1)', color: 'var(--danger)' }}>{error}</div>}

      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="w-4 h-4" style={{ color: 'var(--muted)' }} />
          <h3 className="text-sm font-semibold">The client's link</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs px-2.5 py-1.5 rounded-md flex-1 min-w-[240px] break-all" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
            {publicUrl}
          </code>
          <button onClick={copyLink} className="btn btn-secondary btn-sm">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          Anyone with this link can read the proposal and approve it. No login, nothing to install.
        </p>
      </div>

      <div className="card">
        <div className="flex items-start justify-between mb-6 pb-6 border-b flex-wrap gap-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Prepared for</p>
            {proposal.contact ? (
              <>
                <p className="font-semibold">{proposal.contact.first_name} {proposal.contact.last_name}</p>
                {proposal.contact.company?.name && <p className="text-sm" style={{ color: 'var(--muted)' }}>{proposal.contact.company.name}</p>}
                {proposal.contact.email && <p className="text-sm" style={{ color: 'var(--muted)' }}>{proposal.contact.email}</p>}
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{proposal.company?.name ?? 'No client attached yet'}</p>
            )}
          </div>
          <div className="text-right text-sm">
            <p><span style={{ color: 'var(--muted)' }}>Issued:</span> {formatDate(proposal.issue_date)}</p>
            {proposal.valid_until && <p><span style={{ color: 'var(--muted)' }}>Valid until:</span> {formatDate(proposal.valid_until)}</p>}
            {proposal.needed_by && <p><span style={{ color: 'var(--muted)' }}>Needed by:</span> {formatDate(proposal.needed_by)}</p>}
          </div>
        </div>

        {proposal.intro && <p className="text-sm mb-6 whitespace-pre-wrap">{proposal.intro}</p>}

        <div className="table-container mb-6">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Each</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="font-medium">{i.description}</div>
                    {i.details && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{i.details}</div>}
                  </td>
                  <td className="text-right tabular-nums" style={{ color: 'var(--muted)' }}>{i.quantity}</td>
                  <td className="text-right tabular-nums" style={{ color: 'var(--muted)' }}>{formatCurrency(Number(i.unit_price))}</td>
                  <td className="text-right tabular-nums font-medium">{formatCurrency(Number(i.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="max-w-xs ml-auto space-y-2 text-sm">
          <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Subtotal</span><span className="tabular-nums">{formatCurrency(Number(proposal.subtotal))}</span></div>
          {Number(proposal.discount_amount) > 0 && (
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Discount</span><span className="tabular-nums">−{formatCurrency(Number(proposal.discount_amount))}</span></div>
          )}
          {Number(proposal.shipping_amount) > 0 && (
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Shipping</span><span className="tabular-nums">{formatCurrency(Number(proposal.shipping_amount))}</span></div>
          )}
          {Number(proposal.tax_rate) > 0 && (
            <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Tax ({proposal.tax_rate}%)</span><span className="tabular-nums">{formatCurrency(Number(proposal.tax_amount))}</span></div>
          )}
          <div className="flex justify-between pt-3 border-t text-lg" style={{ borderColor: 'var(--border)' }}>
            <span className="font-semibold">Total</span>
            <span className="font-bold tabular-nums" style={{ color: 'var(--accent-light)' }}>{formatCurrency(Number(proposal.total))}</span>
          </div>
        </div>

        {(proposal.notes || proposal.terms) && (
          <div className="mt-8 pt-6 border-t space-y-4" style={{ borderColor: 'var(--border)' }}>
            {proposal.notes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Notes</p>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{proposal.notes}</p>
              </div>
            )}
            {proposal.terms && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>Terms</p>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{proposal.terms}</p>
              </div>
            )}
          </div>
        )}

        {proposal.accepted_at && (
          <div className="mt-6 p-4 rounded-lg flex items-start gap-3" style={{ background: 'rgba(0,184,148,0.08)' }}>
            <FileText className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
            <div className="text-sm">
              <p className="font-semibold" style={{ color: 'var(--success)' }}>
                Approved{proposal.accepted_by_name ? ` by ${proposal.accepted_by_name}` : ''} on {formatDate(proposal.accepted_at)}
              </p>
              {proposal.accepted_note && <p className="mt-1" style={{ color: 'var(--muted)' }}>{proposal.accepted_note}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
