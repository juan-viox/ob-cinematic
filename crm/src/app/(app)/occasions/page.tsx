import { createServerSupabaseClient } from '@/lib/supabase/server'
import OccasionsClient from './OccasionsClient'

export const metadata = { title: 'Gifting calendar' }

export default async function OccasionsPage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: occasions }, { data: clientOccasions }, { data: contacts }, { data: products }] =
    await Promise.all([
      supabase.from('occasions').select('*').order('sort_order'),
      supabase
        .from('client_occasions')
        .select(
          'id, title, occasion_date, status, quantity, budget, recipient_name, ship_to, notes, recurs_annually, contact_id, company_id, occasion_id, product_id, proposal_id, deal_id, contact:contacts(id, first_name, last_name, email, phone), company:companies(id, name), product:products(id, name, price, sku)'
        )
        .order('occasion_date'),
      supabase.from('contacts').select('id, first_name, last_name, email, company_id').order('first_name'),
      supabase.from('products').select('id, name, price, sku, category').eq('is_active', true).order('sort_order'),
    ])

  return (
    <OccasionsClient
      occasions={occasions ?? []}
      clientOccasions={(clientOccasions ?? []) as never[]}
      contacts={contacts ?? []}
      products={(products ?? []) as never[]}
    />
  )
}
