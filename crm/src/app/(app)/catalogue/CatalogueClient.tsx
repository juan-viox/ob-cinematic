'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import {
  Package, Boxes, Search, Pencil, Save, X, Loader2, AlertTriangle,
  Plus, Minus, Layers, CircleDollarSign,
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { CatalogueProduct, InventoryItem, ProductComponent } from '@/types'

const TABS = [
  { key: 'box', label: 'Gift boxes', icon: Package },
  { key: 'tier', label: 'Tiers & services', icon: Layers },
  { key: 'plan', label: 'Concierge plans', icon: CircleDollarSign },
  { key: 'addon', label: 'Add-ons', icon: Plus },
  { key: 'inventory', label: 'Inventory', icon: Boxes },
] as const

type TabKey = (typeof TABS)[number]['key']

/** Tiers and services share a tab; add-ons have their own. */
function inTab(category: string, tab: TabKey): boolean {
  if (tab === 'tier') return category === 'tier' || category === 'service'
  return category === tab
}

export default function CatalogueClient({
  products: initialProducts,
  items: initialItems,
  components,
}: {
  products: CatalogueProduct[]
  items: InventoryItem[]
  components: Pick<ProductComponent, 'id' | 'product_id' | 'inventory_item_id' | 'quantity' | 'sort_order'>[]
}) {
  const [tab, setTab] = useState<TabKey>('box')
  const [products, setProducts] = useState(initialProducts)
  const [items, setItems] = useState(initialItems)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const supabase = createClient()

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const componentsByProduct = useMemo(() => {
    const map = new Map<string, typeof components>()
    for (const c of components) {
      const list = map.get(c.product_id) ?? []
      list.push(c)
      map.set(c.product_id, list)
    }
    return map
  }, [components])

  const usageByItem = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of components) map.set(c.inventory_item_id, (map.get(c.inventory_item_id) ?? 0) + 1)
    return map
  }, [components])

  const q = search.trim().toLowerCase()
  const shownProducts = products
    .filter((p) => inTab(p.category, tab))
    .filter((p) => !q || `${p.name} ${p.sku ?? ''} ${p.description ?? ''}`.toLowerCase().includes(q))
  const shownItems = items.filter(
    (i) => !q || `${i.brand} ${i.name} ${i.description ?? ''} ${i.supplier ?? ''}`.toLowerCase().includes(q)
  )

  const lowStockProducts = products.filter((p) => p.track_stock && p.stock_on_hand <= p.reorder_at)
  const lowStockItems = items.filter((i) => i.is_active && i.reorder_at > 0 && i.on_hand <= i.reorder_at)

  function startEdit(row: CatalogueProduct | InventoryItem, kind: 'product' | 'item') {
    setError('')
    setEditing(`${kind}:${row.id}`)
    if (kind === 'product') {
      const p = row as CatalogueProduct
      setDraft({
        name: p.name,
        price: String(p.price ?? 0),
        cost: p.cost === null || p.cost === undefined ? '' : String(p.cost),
        price_note: p.price_note ?? '',
        description: p.description ?? '',
        track_stock: p.track_stock ? '1' : '',
        stock_on_hand: String(p.stock_on_hand ?? 0),
        reorder_at: String(p.reorder_at ?? 0),
        is_active: p.is_active ? '1' : '',
      })
    } else {
      const i = row as InventoryItem
      setDraft({
        brand: i.brand,
        name: i.name,
        description: i.description ?? '',
        unit_cost: i.unit_cost === null || i.unit_cost === undefined ? '' : String(i.unit_cost),
        reorder_at: String(i.reorder_at ?? 0),
        supplier: i.supplier ?? '',
        supplier_url: i.supplier_url ?? '',
        is_active: i.is_active ? '1' : '',
      })
    }
  }

  async function saveProduct(p: CatalogueProduct) {
    setSaving(true)
    setError('')
    const patch = {
      name: draft.name.trim() || p.name,
      price: Number(draft.price) || 0,
      cost: draft.cost === '' ? null : Number(draft.cost),
      price_note: draft.price_note.trim() || null,
      description: draft.description.trim() || null,
      track_stock: draft.track_stock === '1',
      reorder_at: Math.max(0, Math.round(Number(draft.reorder_at) || 0)),
      is_active: draft.is_active === '1',
    }
    const { error: err } = await supabase.from('products').update(patch).eq('id', p.id)
    if (err) { setError(err.message); setSaving(false); return }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))
    setEditing(null)
    setSaving(false)
  }

  async function saveItem(i: InventoryItem) {
    setSaving(true)
    setError('')
    const patch = {
      brand: draft.brand.trim(),
      name: draft.name.trim() || i.name,
      description: draft.description.trim() || null,
      unit_cost: draft.unit_cost === '' ? null : Number(draft.unit_cost),
      reorder_at: Math.max(0, Math.round(Number(draft.reorder_at) || 0)),
      supplier: draft.supplier.trim() || null,
      supplier_url: draft.supplier_url.trim() || null,
      is_active: draft.is_active === '1',
    }
    const { error: err } = await supabase.from('inventory_items').update(patch).eq('id', i.id)
    if (err) { setError(err.message); setSaving(false); return }
    setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, ...patch } : x)))
    setEditing(null)
    setSaving(false)
  }

  /**
   * Stock only ever changes through a movement, so the count and the audit
   * trail can never drift apart. The trigger updates the row; we mirror it
   * here so the number moves without a reload.
   */
  async function adjustStock(
    target: { kind: 'product' | 'item'; id: string; organization_id: string },
    delta: number,
    reason: 'received' | 'adjustment' | 'damaged' | 'count'
  ) {
    const { error: err } = await supabase.from('inventory_movements').insert({
      organization_id: target.organization_id,
      product_id: target.kind === 'product' ? target.id : null,
      inventory_item_id: target.kind === 'item' ? target.id : null,
      delta,
      reason,
    })
    if (err) { setError(err.message); return }
    if (target.kind === 'product') {
      setProducts((prev) => prev.map((p) => (p.id === target.id ? { ...p, stock_on_hand: p.stock_on_hand + delta } : p)))
    } else {
      setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, on_hand: i.on_hand + delta } : i)))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Catalogue &amp; Inventory</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Every box, tier, plan and add-on we sell, and what is on the shelf to build them with
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the catalogue..."
            className="w-full pl-10"
          />
        </div>
      </div>

      {(lowStockProducts.length > 0 || lowStockItems.length > 0) && (
        <div
          className="card mb-6 flex items-start gap-3"
          style={{ borderColor: 'rgba(253,203,110,0.35)', background: 'rgba(253,203,110,0.06)' }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
          <div className="text-sm">
            <p className="font-semibold mb-1">At or below the reorder point</p>
            <p style={{ color: 'var(--muted)' }}>
              {[
                ...lowStockProducts.map((p) => `${p.name} (${p.stock_on_hand})`),
                ...lowStockItems.map((i) => `${[i.brand, i.name].filter(Boolean).join(' ')} (${i.on_hand})`),
              ]
                .slice(0, 8)
                .join(' · ')}
              {lowStockProducts.length + lowStockItems.length > 8 &&
                ` and ${lowStockProducts.length + lowStockItems.length - 8} more`}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg text-sm mb-4" style={{ background: 'rgba(225,112,85,0.1)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="tab-list mb-6">
        {TABS.map((t) => {
          const count = t.key === 'inventory' ? items.length : products.filter((p) => inTab(p.category, t.key)).length
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setEditing(null) }}
              className={`tab-item flex items-center gap-1.5 ${tab === t.key ? 'active' : ''}`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              <span className="text-xs px-1.5 py-0.5 rounded-full ml-1" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {tab !== 'inventory' ? (
        <div className="space-y-3">
          {shownProducts.map((p) => {
            const isEditing = editing === `product:${p.id}`
            const parts = componentsByProduct.get(p.id) ?? []
            const low = p.track_stock && p.stock_on_hand <= p.reorder_at
            return (
              <div key={p.id} className="card" style={{ opacity: p.is_active ? 1 : 0.55 }}>
                <div className="flex items-start gap-4">
                  {p.image_url ? (
                    <Image
                      src={`https://occasionsbox.com${p.image_url}`}
                      alt=""
                      width={72}
                      height={72}
                      unoptimized
                      className="rounded-lg object-cover shrink-0"
                      style={{ width: 72, height: 72 }}
                    />
                  ) : (
                    <div className="rounded-lg shrink-0 flex items-center justify-center" style={{ width: 72, height: 72, background: 'var(--surface-2)' }}>
                      <Package className="w-6 h-6" style={{ color: 'var(--muted)' }} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="col-span-2">
                          <label>Name</label>
                          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full" />
                        </div>
                        <div>
                          <label>Price</label>
                          <input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="w-full" />
                        </div>
                        <div>
                          <label>Cost to build</label>
                          <input type="number" min="0" step="0.01" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} className="w-full" placeholder="optional" />
                        </div>
                        <div className="col-span-2">
                          <label>Price note</label>
                          <input value={draft.price_note} onChange={(e) => setDraft({ ...draft, price_note: e.target.value })} className="w-full" placeholder="per box · 12 box minimum" />
                        </div>
                        <div>
                          <label>Reorder at</label>
                          <input type="number" min="0" value={draft.reorder_at} onChange={(e) => setDraft({ ...draft, reorder_at: e.target.value })} className="w-full" />
                        </div>
                        <div className="flex items-end gap-4 pb-2">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={draft.track_stock === '1'} onChange={(e) => setDraft({ ...draft, track_stock: e.target.checked ? '1' : '' })} />
                            Count stock
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={draft.is_active === '1'} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked ? '1' : '' })} />
                            Active
                          </label>
                        </div>
                        <div className="col-span-2 md:col-span-4">
                          <label>Description</label>
                          <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full" />
                        </div>
                        <div className="col-span-2 md:col-span-4 flex justify-end gap-2">
                          <button onClick={() => setEditing(null)} className="btn btn-secondary btn-sm">Cancel</button>
                          <button onClick={() => saveProduct(p)} disabled={saving} className="btn btn-primary btn-sm">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <h3 className="font-semibold truncate">{p.name}</h3>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                              {p.sku}
                              {p.description ? ` · ${p.description}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <div className="font-bold" style={{ color: 'var(--accent-light)' }}>{formatCurrency(Number(p.price))}</div>
                              {p.price_note && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{p.price_note}</div>}
                              {p.cost !== null && p.cost !== undefined && (
                                <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                                  cost {formatCurrency(Number(p.cost))} · margin {Math.round(((Number(p.price) - Number(p.cost)) / Number(p.price)) * 100)}%
                                </div>
                              )}
                            </div>
                            <button onClick={() => startEdit(p, 'product')} className="p-1.5 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--muted)' }} title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {p.occasions?.map((o) => (
                            <span key={o} className="badge badge-neutral text-[10px]">{o}</span>
                          ))}
                          {p.caution && (
                            <span className="badge text-[10px]" style={{ background: 'rgba(253,203,110,0.15)', color: 'var(--warning)' }}>
                              {p.caution}
                            </span>
                          )}
                          {!p.is_active && <span className="badge badge-neutral text-[10px]">Inactive</span>}
                        </div>

                        <div className="flex items-center gap-4 mt-3 flex-wrap">
                          {p.track_stock ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>On hand</span>
                              <button onClick={() => adjustStock({ kind: 'product', id: p.id, organization_id: p.organization_id }, -1, 'adjustment')} className="btn btn-ghost btn-icon btn-sm" title="One fewer">
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="font-semibold tabular-nums" style={{ color: low ? 'var(--warning)' : 'var(--text)' }}>{p.stock_on_hand}</span>
                              <button onClick={() => adjustStock({ kind: 'product', id: p.id, organization_id: p.organization_id }, 1, 'received')} className="btn btn-ghost btn-icon btn-sm" title="One more">
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              {low && <span className="text-xs" style={{ color: 'var(--warning)' }}>at reorder point ({p.reorder_at})</span>}
                            </div>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--muted)' }}>Built to order</span>
                          )}

                          {parts.length > 0 && (
                            <button onClick={() => setExpanded(expanded === p.id ? null : p.id)} className="text-xs hover:underline" style={{ color: 'var(--accent-light)' }}>
                              {expanded === p.id ? 'Hide' : 'Show'} {parts.length} item{parts.length === 1 ? '' : 's'} inside
                            </button>
                          )}
                        </div>

                        {expanded === p.id && parts.length > 0 && (
                          <ul className="mt-3 pt-3 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
                            {parts.map((c) => {
                              const item = itemsById.get(c.inventory_item_id)
                              if (!item) return null
                              const short = item.on_hand <= item.reorder_at && item.reorder_at > 0
                              return (
                                <li key={c.id} className="text-sm flex items-center justify-between gap-3">
                                  <span className="truncate">
                                    {item.brand && <span className="font-medium">{item.brand} </span>}
                                    {item.name}
                                    {c.quantity > 1 && <span style={{ color: 'var(--muted)' }}> ×{c.quantity}</span>}
                                  </span>
                                  <span className="text-xs tabular-nums shrink-0" style={{ color: short ? 'var(--warning)' : 'var(--muted)' }}>
                                    {item.on_hand} on hand
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {shownProducts.length === 0 && (
            <div className="card text-center py-12" style={{ color: 'var(--muted)' }}>
              Nothing here yet. Run the catalogue seed, or adjust your search.
            </div>
          )}
        </div>
      ) : (
        <div className="card p-0">
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Used in</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">Reorder at</th>
                  <th>Supplier</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownItems.map((i) => {
                  const isEditing = editing === `item:${i.id}`
                  const low = i.reorder_at > 0 && i.on_hand <= i.reorder_at
                  if (isEditing) {
                    return (
                      <tr key={i.id}>
                        <td colSpan={7}>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-2">
                            <div><label>Brand</label><input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className="w-full" /></div>
                            <div><label>Name</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full" /></div>
                            <div><label>Unit cost</label><input type="number" min="0" step="0.01" value={draft.unit_cost} onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value })} className="w-full" /></div>
                            <div><label>Reorder at</label><input type="number" min="0" value={draft.reorder_at} onChange={(e) => setDraft({ ...draft, reorder_at: e.target.value })} className="w-full" /></div>
                            <div><label>Supplier</label><input value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} className="w-full" /></div>
                            <div className="md:col-span-2"><label>Supplier link</label><input value={draft.supplier_url} onChange={(e) => setDraft({ ...draft, supplier_url: e.target.value })} className="w-full" placeholder="https://" /></div>
                            <div className="flex items-end pb-2">
                              <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={draft.is_active === '1'} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked ? '1' : '' })} /> Active
                              </label>
                            </div>
                            <div className="col-span-2 md:col-span-4"><label>Description</label><textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full" /></div>
                            <div className="col-span-2 md:col-span-4 flex justify-end gap-2">
                              <button onClick={() => setEditing(null)} className="btn btn-secondary btn-sm"><X className="w-4 h-4" /> Cancel</button>
                              <button onClick={() => saveItem(i)} disabled={saving} className="btn btn-primary btn-sm">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={i.id} style={{ opacity: i.is_active ? 1 : 0.5 }}>
                      <td>
                        <div className="font-medium">{[i.brand, i.name].filter(Boolean).join(' · ')}</div>
                        {i.description && <div className="text-xs max-w-md truncate" style={{ color: 'var(--muted)' }}>{i.description}</div>}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{usageByItem.get(i.id) ?? 0} box{(usageByItem.get(i.id) ?? 0) === 1 ? '' : 'es'}</td>
                      <td className="text-right" style={{ color: 'var(--muted)' }}>{i.unit_cost === null || i.unit_cost === undefined ? '—' : formatCurrency(Number(i.unit_cost))}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => adjustStock({ kind: 'item', id: i.id, organization_id: i.organization_id }, -1, 'adjustment')} className="btn btn-ghost btn-icon btn-sm"><Minus className="w-3 h-3" /></button>
                          <span className="font-semibold tabular-nums w-8" style={{ color: low ? 'var(--warning)' : 'var(--text)' }}>{i.on_hand}</span>
                          <button onClick={() => adjustStock({ kind: 'item', id: i.id, organization_id: i.organization_id }, 1, 'received')} className="btn btn-ghost btn-icon btn-sm"><Plus className="w-3 h-3" /></button>
                        </div>
                      </td>
                      <td className="text-right tabular-nums" style={{ color: 'var(--muted)' }}>{i.reorder_at || '—'}</td>
                      <td style={{ color: 'var(--muted)' }} className="max-w-[160px] truncate">
                        {i.supplier_url ? (
                          <a href={i.supplier_url} target="_blank" rel="noreferrer" className="hover:underline">{i.supplier || 'Link'}</a>
                        ) : (i.supplier || '—')}
                      </td>
                      <td>
                        <button onClick={() => startEdit(i, 'item')} className="p-1.5 rounded-md hover:bg-[var(--surface-2)]" style={{ color: 'var(--muted)' }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
