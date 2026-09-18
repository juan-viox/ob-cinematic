import { createServerSupabaseClient } from '@/lib/supabase/server'
import NewProposalClient from './NewProposalClient'

export const metadata = { title: 'New proposal' }

export default async function NewProposalPage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: contacts }, { data: products }, { data: clientOccasions }] = await Promise.all([
    supabase.from('contacts').select('id, first_name, last_name, email, company_id').order('first_name'),
    supabase.from('products').select('id, sku, name, description, price, unit, price_note, category').eq('is_active', true).order('category').order('sort_order'),
    supabase.from('client_occasions').select('id, title, occasion_date, quantity, contact_id, product_id').order('occasion_date'),
  ])

  return (
    <NewProposalClient
      contacts={contacts ?? []}
      products={(products ?? []) as never[]}
      clientOccasions={(clientOccasions ?? []) as never[]}
    />
  )
}
