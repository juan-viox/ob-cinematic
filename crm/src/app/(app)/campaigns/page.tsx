import { createServerSupabaseClient } from '@/lib/supabase/server'
import CampaignsClient from './CampaignsClient'

export const metadata = { title: 'Campaigns' }

export default async function CampaignsPage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: tags }, { data: templates }] = await Promise.all([
    supabase.from('tags').select('id, name, color').order('name'),
    supabase.from('email_templates').select('id, name, subject, body').order('name'),
  ])

  // How many contacts each tag actually carries, so the picker can say so
  // rather than making someone select a tag to find out it is empty.
  const { data: links } = await supabase
    .from('entity_tags')
    .select('tag_id')
    .eq('entity_type', 'contact')

  const counts = new Map<string, number>()
  for (const l of (links ?? []) as Array<{ tag_id: string }>) {
    counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1)
  }

  return (
    <CampaignsClient
      tags={(tags ?? []).map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }))}
      templates={templates ?? []}
    />
  )
}
