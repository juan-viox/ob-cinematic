import type { SupabaseClient } from '@supabase/supabase-js'
import crmConfig from '@/crm.config'
import { IngestError, jsonError, safeEqualStrings } from '@/lib/ingest'

/**
 * Shared pieces for the voice agent's tools (src/app/api/v1/agent/**).
 *
 * These endpoints read customer data and write opportunities, so unlike the
 * ingest routes they never accept an Origin header as authorisation: only a
 * server-to-server caller holding SITE_API_KEY (ElevenLabs, sending it as the
 * x-api-key header on every tool call) gets in.
 */

export type AgentAuth = { ok: true } | { ok: false; status: number; error: string }

export function authorizeAgent(request: Request): AgentAuth {
  const configured = process.env.SITE_API_KEY
  const provided = request.headers.get('x-api-key')
  if (!configured) return { ok: false, status: 503, error: 'SITE_API_KEY is not configured' }
  if (!provided || !safeEqualStrings(provided, configured)) {
    return { ok: false, status: 401, error: 'Invalid API key' }
  }
  return { ok: true }
}

/** Runs the handler with the API-key check and uniform error handling. */
export async function withAgentAuth(
  request: Request,
  route: string,
  handler: () => Promise<Response>
): Promise<Response> {
  const auth = authorizeAgent(request)
  if (!auth.ok) return jsonError(request, auth.error, auth.status)
  try {
    return await handler()
  } catch (err) {
    if (err instanceof IngestError) return jsonError(request, err.message, err.status)
    console.error(`[agent:${route}]`, err instanceof Error ? err.message : err)
    return jsonError(request, 'Internal server error', 500)
  }
}

/** Absolute URL on the marketing site for a catalogue path. */
export function siteUrl(path: string): string {
  const base = crmConfig.siteIntegration.siteUrl.replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function money(n: number | string | null | undefined): string {
  const v = Number(n) || 0
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/** A short spoken-friendly description of what a box holds. */
export function contentsSummary(contents: unknown, max = 5): string {
  if (!Array.isArray(contents)) return ''
  const names = contents
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.split('|')[0].trim())
    .filter((c) => c && !/keepsake|handwritten card/i.test(c))
  return names.slice(0, max).join(', ') + (names.length > max ? ` and ${names.length - max} more` : '')
}

export interface CatalogueRow {
  id: string
  sku: string | null
  slug: string | null
  category: string
  name: string
  description: string | null
  price: number
  unit: string
  price_note: string | null
  contents: unknown
  occasions: string[]
  caution: string | null
  track_stock: boolean
  stock_on_hand: number
  is_active: boolean
}

export const CATALOGUE_COLUMNS =
  'id, sku, slug, category, name, description, price, unit, price_note, contents, occasions, caution, track_stock, stock_on_hand, is_active'

export async function loadCatalogue(supabase: SupabaseClient, orgId: string): Promise<CatalogueRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select(CATALOGUE_COLUMNS)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('category')
    .order('sort_order')
  if (error) throw new IngestError('Unable to read the catalogue', 500)
  return (data ?? []) as CatalogueRow[]
}

export function describeProduct(p: CatalogueRow) {
  const inStock = !p.track_stock || p.stock_on_hand > 0
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    price: Number(p.price),
    price_label: p.price_note ? `${money(p.price)} ${p.price_note}` : money(p.price),
    unit: p.unit,
    description: p.description,
    inside: contentsSummary(p.contents),
    occasions: p.occasions,
    caution: p.caution,
    in_stock: inStock,
    url: p.category === 'box' && p.slug ? siteUrl(`/shop/${p.slug}`) : p.category === 'plan' ? siteUrl('/concierge') : siteUrl('/custom-gifting'),
  }
}
