import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ContactDetailClient from './ContactDetailClient'

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const { data: contact } = await supabase
    .from('contacts')
    .select('*, company:companies(name)')
    .eq('id', id)
    .single()

  if (!contact) notFound()

  const { data: activities } = await supabase
    .from('activities')
    .select('*')
    .eq('contact_id', id)
    .order('created_at', { ascending: false })

  const { data: deals } = await supabase
    .from('deals')
    .select('*, stage:deal_stages(name, color)')
    .eq('contact_id', id)
    .order('created_at', { ascending: false })

  // entity_tags is polymorphic and carries no organization_id, so the join
  // through tags is what keeps this to the caller's own org under RLS.
  const { data: tagLinks } = await supabase
    .from('entity_tags')
    .select('tag:tags(id, name, color)')
    .eq('entity_type', 'contact')
    .eq('entity_id', id)

  const tags = (tagLinks ?? [])
    .map((l) => {
      const t = (l as { tag: unknown }).tag
      return (Array.isArray(t) ? t[0] : t) as { id: string; name: string; color: string | null } | null
    })
    .filter((t): t is { id: string; name: string; color: string | null } => !!t)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <ContactDetailClient
      contact={contact}
      activities={activities ?? []}
      deals={deals ?? []}
      tags={tags}
    />
  )
}
