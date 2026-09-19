import { createServerSupabaseClient } from '@/lib/supabase/server'
import OrdersClient from './OrdersClient'

export const metadata = { title: 'Orders' }

export default async function OrdersPage() {
  const supabase = await createServerSupabaseClient()

  const { data: orders } = await supabase
    .from('orders')
    .select(
      'id, order_number, source, placed_at, payment_status, payment_provider, payment_reference, payer_name, payer_email, payer_phone, fulfillment_status, ship_to_name, ship_to_address, carrier, tracking_number, needed_by, currency, total, verified, notes, contact:contacts(id, first_name, last_name, email), items:order_items(id, description, variant, card, card_message, quantity, unit_price, total, sku, sort_order)'
    )
    .order('placed_at', { ascending: false })
    .limit(200)

  return <OrdersClient orders={(orders ?? []) as never[]} />
}
