import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { renderProposalHtml } from '@/lib/proposal-html'
import type { Proposal, ProposalItem } from '@/types'

/** GET /api/v1/proposals/{id}/print — the proposal as a printable page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  if (!session.ok) return session.response

  const { id } = await params
  const supabase = createAdminClient()

  const { data: proposal } = await supabase
    .from('proposals')
    .select('*, contact:contacts(id, first_name, last_name, email, phone, company:companies(name)), company:companies(id, name)')
    .eq('id', id)
    .eq('organization_id', session.ctx.organizationId)
    .single()

  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const { data: items } = await supabase.from('proposal_items').select('*').eq('proposal_id', id).order('sort_order')

  const html = renderProposalHtml(proposal as Proposal, (items ?? []) as ProposalItem[], { printToolbar: true })
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
