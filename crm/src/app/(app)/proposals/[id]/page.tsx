import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ProposalDetailClient from './ProposalDetailClient'

export const metadata = { title: 'Proposal' }

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: proposal } = await supabase
    .from('proposals')
    .select(
      '*, contact:contacts(id, first_name, last_name, email, phone, company:companies(name)), company:companies(id, name), deal:deals(id, title)'
    )
    .eq('id', id)
    .single()

  if (!proposal) notFound()

  const { data: items } = await supabase
    .from('proposal_items')
    .select('*')
    .eq('proposal_id', id)
    .order('sort_order')

  return <ProposalDetailClient proposal={proposal as never} items={items ?? []} />
}
