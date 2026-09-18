'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Eye, CheckCircle2, Clock } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PROPOSAL_STATUS_STYLES, type ProposalStatus } from '@/lib/proposals'
import type { Proposal } from '@/types'

export default function ProposalsClient({ proposals }: { proposals: Proposal[] }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ProposalStatus>('all')

  const q = search.trim().toLowerCase()
  const shown = useMemo(
    () =>
      proposals.filter((p) => {
        if (status !== 'all' && p.status !== status) return false
        if (!q) return true
        const who = `${p.contact?.first_name ?? ''} ${p.contact?.last_name ?? ''} ${p.company?.name ?? ''}`
        return `${p.proposal_number} ${p.title} ${who}`.toLowerCase().includes(q)
      }),
    [proposals, status, q]
  )

  const open = proposals.filter((p) => ['sent', 'viewed'].includes(p.status))
  const openValue = open.reduce((s, p) => s + Number(p.total), 0)
  const accepted = proposals.filter((p) => p.status === 'accepted')
  const acceptedValue = accepted.reduce((s, p) => s + Number(p.total), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Proposals</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            What we quoted, what the client has seen, and what they approved
          </p>
        </div>
        <Link href="/proposals/new" className="btn btn-primary">
          <Plus className="w-4 h-4" /> New proposal
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(108,92,231,0.15)' }}><Clock className="w-5 h-5" style={{ color: 'var(--accent-light)' }} /></div>
          <div><p className="text-sm" style={{ color: 'var(--muted)' }}>Out with clients</p><p className="text-2xl font-bold">{formatCurrency(openValue)}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(116,185,255,0.15)' }}><Eye className="w-5 h-5" style={{ color: 'var(--info)' }} /></div>
          <div><p className="text-sm" style={{ color: 'var(--muted)' }}>Opened, not answered</p><p className="text-2xl font-bold">{proposals.filter((p) => p.status === 'viewed').length}</p></div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(0,184,148,0.15)' }}><CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} /></div>
          <div><p className="text-sm" style={{ color: 'var(--muted)' }}>Approved</p><p className="text-2xl font-bold">{formatCurrency(acceptedValue)}</p></div>
        </div>
      </div>

      <div className="card p-0">
        <div className="p-4 border-b flex items-center gap-4 flex-wrap" style={{ borderColor: 'var(--border)' }}>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--muted)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search proposals..." className="w-full pl-10" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | ProposalStatus)} className="w-40">
            <option value="all">All statuses</option>
            {Object.entries(PROPOSAL_STATUS_STYLES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Client</th>
                <th>Status</th>
                <th>Issued</th>
                <th>Needed by</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const s = PROPOSAL_STATUS_STYLES[p.status]
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/proposals/${p.id}`} className="font-medium hover:underline" style={{ color: 'var(--accent-light)' }}>
                        {p.proposal_number}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate">{p.title}</td>
                    <td style={{ color: 'var(--muted)' }}>
                      {p.contact ? `${p.contact.first_name} ${p.contact.last_name ?? ''}` : p.company?.name ?? '–'}
                    </td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
                    <td style={{ color: 'var(--muted)' }}>{formatDate(p.issue_date)}</td>
                    <td style={{ color: 'var(--muted)' }}>{p.needed_by ? formatDate(p.needed_by) : '–'}</td>
                    <td className="text-right font-semibold">{formatCurrency(Number(p.total))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
