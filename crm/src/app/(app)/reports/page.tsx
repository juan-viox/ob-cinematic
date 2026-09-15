import { createServerSupabaseClient } from '@/lib/supabase/server'
import ReportsClient from './ReportsClient'

interface StageRow {
  id: string
  name: string
  color: string
  sort_order: number
  is_won: boolean | null
  is_lost: boolean | null
}

interface DealRow {
  id: string
  title: string
  amount: number | string | null
  probability: number | null
  stage_id: string
  created_at: string
  updated_at: string
  close_date: string | null
  closed_at: string | null
}

export default async function ReportsPage() {
  const supabase = await createServerSupabaseClient()

  // Fetch all raw data for reports
  const [
    dealsRes,
    contactsRes,
    activitiesRes,
    stagesRes,
    profilesRes,
  ] = await Promise.all([
    supabase
      .from('deals')
      .select('id, title, amount, probability, stage_id, created_at, updated_at, close_date, closed_at'),
    supabase
      .from('contacts')
      .select('id, source, created_at'),
    supabase
      .from('activities')
      .select('id, type, user_id, created_at, status'),
    supabase
      .from('deal_stages')
      .select('id, name, color, sort_order, is_won, is_lost')
      .order('sort_order'),
    supabase
      .from('profiles')
      .select('id, full_name'),
  ])

  // Fetch companies with deal counts
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name')

  const { data: dealCompanies } = await supabase
    .from('deals')
    .select('company_id')
    .not('company_id', 'is', null)

  const companyDealCounts: Record<string, number> = {}
  ;(dealCompanies ?? []).forEach((d) => {
    const cid = d.company_id as string
    companyDealCounts[cid] = (companyDealCounts[cid] || 0) + 1
  })

  // Compute deal status from stage is_won/is_lost flags
  const stages = (stagesRes.data ?? []) as StageRow[]
  const wonStageIds = new Set(stages.filter((s) => s.is_won).map((s) => s.id))
  const lostStageIds = new Set(stages.filter((s) => s.is_lost).map((s) => s.id))

  const dealsWithStatus = ((dealsRes.data ?? []) as DealRow[]).map((d) => ({
    ...d,
    amount: Number(d.amount ?? 0) || 0,
    probability: d.probability == null ? null : Number(d.probability),
    status: wonStageIds.has(d.stage_id) ? 'won'
      : lostStageIds.has(d.stage_id) ? 'lost'
      : 'open',
  }))

  return (
    <ReportsClient
      deals={dealsWithStatus}
      contacts={contactsRes.data ?? []}
      activities={activitiesRes.data ?? []}
      stages={stages}
      teamMembers={((profilesRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, name: p.full_name || 'Unknown' }))}
      topCompanies={(companies ?? [])
        .map(c => ({ name: c.name, deals: companyDealCounts[c.id] || 0 }))
        .sort((a, b) => b.deals - a.deals)
        .slice(0, 10)}
    />
  )
}
