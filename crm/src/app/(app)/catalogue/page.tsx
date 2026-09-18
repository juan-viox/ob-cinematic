import { createServerSupabaseClient } from '@/lib/supabase/server'
import CatalogueClient from './CatalogueClient'

export const metadata = { title: 'Catalogue & Inventory' }

export default async function CataloguePage() {
  const supabase = await createServerSupabaseClient()

  const [{ data: products }, { data: items }, { data: components }] = await Promise.all([
    supabase.from('products').select('*').order('category').order('sort_order'),
    supabase.from('inventory_items').select('*').order('brand').order('name'),
    supabase
      .from('product_components')
      .select('id, product_id, inventory_item_id, quantity, sort_order')
      .order('sort_order'),
  ])

  return (
    <CatalogueClient
      products={products ?? []}
      items={items ?? []}
      components={components ?? []}
    />
  )
}
