import { getIngestClient, getOrgId, handleOptions, jsonOk } from '@/lib/ingest'
import { withAgentAuth, loadCatalogue, money } from '@/lib/agent-api'
import { approveBy, daysBetween, formatLongDate, nextOccurrence, toISODate, today } from '@/lib/occasions'
import type { Occasion } from '@/types'

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * GET /api/v1/agent/occasions?days=90
 *
 * The gifting calendar, as Olivia should talk about it: what is coming up,
 * the date a proposal must be approved by to make it, and the boxes we
 * suggest for each.
 */
export async function GET(request: Request) {
  return withAgentAuth(request, 'occasions', async () => {
    const url = new URL(request.url)
    const daysRaw = Number(url.searchParams.get('days'))
    const horizon = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 366) : 90

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)
    const [{ data: occasions }, catalogue] = await Promise.all([
      supabase.from('occasions').select('*').eq('organization_id', orgId).eq('is_active', true).order('sort_order'),
      loadCatalogue(supabase, orgId),
    ])
    const bySku = new Map(catalogue.map((p) => [p.sku, p]))
    const now = today()

    const upcoming = ((occasions ?? []) as Occasion[])
      .map((o) => {
        const date = nextOccurrence(o, now)
        if (!date) return null
        const days = daysBetween(now, date)
        if (days > horizon) return null
        const approve = approveBy(date, o.lead_time_days)
        return {
          name: o.name,
          category: o.category,
          date: toISODate(date),
          date_spoken: formatLongDate(date),
          days_until: days,
          approve_by: toISODate(approve),
          still_makeable: approve.getTime() >= now.getTime(),
          talking_points: o.talking_points,
          description: o.description,
          suggested: o.suggested_skus
            .map((sku) => bySku.get(sku))
            .filter((p): p is NonNullable<typeof p> => Boolean(p))
            .map((p) => `${p.name} (${money(p.price)}${p.price_note ? `, ${p.price_note}` : ''})`),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.days_until - b.days_until)

    return jsonOk(request, {
      success: true,
      today: toISODate(now),
      horizon_days: horizon,
      count: upcoming.length,
      occasions: upcoming,
      lead_time: 'Custom and corporate orders need 2 to 4 weeks from approval, 3 to 4 weeks for anything shipping mid October through December, plus 1 to 7 business days in transit. Shop boxes ship in 1 to 3 business days.',
    })
  })
}

/** Some tool runners only POST; accept `days` as a JSON body too. */
export async function POST(request: Request) {
  let days: string | null = null
  try {
    const body = (await request.json()) as { days?: unknown }
    if (body && body.days !== undefined && body.days !== null) days = String(body.days)
  } catch {
    // no body: same as a bare GET
  }
  const url = new URL(request.url)
  url.search = days ? `days=${encodeURIComponent(days)}` : ''
  return GET(new Request(url, { method: 'GET', headers: request.headers }))
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
