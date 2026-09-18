import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import ProposalsClient from './ProposalsClient'

export const metadata = { title: 'Proposals' }

export default async function ProposalsPage() {
  const supabase = await createServerSupabaseClient()

  const { data: proposals } = await supabase
    .from('proposals')
    .select(
      'id, proposal_number, title, status, issue_date, valid_until, needed_by, total, public_token, sent_at, viewed_at, accepted_at, contact:contacts(id, first_name, last_name, email), company:companies(id, name)'
    )
    .order('created_at', { ascending: false })

  if (!proposals || proposals.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Proposals</h1>
          <Link href="/proposals/new" className="btn btn-primary">
            <Plus className="w-4 h-4" /> New proposal
          </Link>
        </div>
        <EmptyState
          icon={FileText}
          title="No proposals yet"
          description="A proposal lists the boxes, the quantity and the ship date, and the client approves it from a link. Approving it starts the lead-time clock."
          actionLabel="New proposal"
          actionHref="/proposals/new"
        />
      </div>
    )
  }

  return <ProposalsClient proposals={proposals as never[]} />
}
