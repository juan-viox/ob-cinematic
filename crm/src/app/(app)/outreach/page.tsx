import { createServerSupabaseClient } from '@/lib/supabase/server'
import OutreachClient from './OutreachClient'

export const metadata = { title: 'Outreach' }

/**
 * Who to talk to today, and why. Everything here is derived: nothing has to
 * be maintained by hand for the list to be right tomorrow.
 */
export default async function OutreachPage() {
  const supabase = await createServerSupabaseClient()

  const [
    { data: occasions },
    { data: clientOccasions },
    { data: contacts },
    { data: deals },
    { data: orders },
    { data: proposals },
    { data: templates },
  ] = await Promise.all([
    supabase.from('occasions').select('*').eq('is_active', true).order('sort_order'),
    supabase
      .from('client_occasions')
      .select('id, title, occasion_date, status, quantity, budget, contact_id, occasion_id, proposal_id, contact:contacts(id, first_name, last_name, email)')
      .in('status', ['planned', 'proposed'])
      .order('occasion_date'),
    supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, status, source, created_at, company:companies(name)')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('deals')
      .select('id, title, amount, created_at, needed_by, contact_id, stage:deal_stages(name, sort_order)')
      .is('closed_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('id, order_number, placed_at, total, contact_id')
      .order('placed_at', { ascending: false })
      .limit(500),
    supabase
      .from('proposals')
      .select('id, proposal_number, title, status, sent_at, total, contact_id')
      .in('status', ['sent', 'viewed'])
      .order('sent_at', { ascending: true }),
    supabase.from('email_templates').select('id, name, subject, category').order('name'),
  ])

  return (
    <OutreachClient
      occasions={occasions ?? []}
      clientOccasions={(clientOccasions ?? []) as never[]}
      contacts={(contacts ?? []) as never[]}
      deals={(deals ?? []) as never[]}
      orders={(orders ?? []) as never[]}
      proposals={(proposals ?? []) as never[]}
      templates={templates ?? []}
    />
  )
}
