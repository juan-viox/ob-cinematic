import { getIngestClient, getOrgId, handleOptions, jsonOk, str } from '@/lib/ingest'
import { withAgentAuth, loadCatalogue, describeProduct } from '@/lib/agent-api'

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/** Words the caller might use for a shop occasion tag. */
const OCCASION_SYNONYMS: Record<string, string[]> = {
  selfcare: ['self care', 'self-care', 'spa', 'relax', 'pamper', 'wellness', 'get well', 'mother'],
  celebration: ['celebrat', 'congrat', 'birthday', 'anniversary', 'promotion', 'cheers', 'toast', 'engagement', 'wedding'],
  hostess: ['host', 'dinner', 'party', 'thanksgiving', 'entertain', 'table'],
  home: ['home', 'housewarm', 'closing', 'new house', 'moving', 'realtor', 'real estate', 'keys', 'buyer'],
  treats: ['treat', 'sweet', 'chocolate', 'coffee', 'tea', 'cookie', 'snack', 'drink'],
  forhim: ['him', 'man', 'men', 'husband', 'father', 'dad', 'boss', 'groom', 'guy'],
  client: ['client', 'corporate', 'business', 'employee', 'team', 'office', 'company', 'appreciation', 'thank'],
}

function matchOccasions(text: string): string[] {
  const t = text.toLowerCase()
  return Object.entries(OCCASION_SYNONYMS)
    .filter(([tag, words]) => t.includes(tag) || words.some((w) => t.includes(w)))
    .map(([tag]) => tag)
}

/**
 * GET /api/v1/agent/catalogue?q=&occasion=&max_price=&category=
 *
 * What Olivia calls when someone asks what to send. Returns at most twelve
 * products, boxes first, ranked by how well they match the words used, with
 * a spoken-friendly summary of what is inside each.
 */
export async function GET(request: Request) {
  return withAgentAuth(request, 'catalogue', async () => {
    const url = new URL(request.url)
    const q = str(url.searchParams.get('q'), 200)?.toLowerCase() ?? ''
    const occasionParam = str(url.searchParams.get('occasion'), 100)?.toLowerCase() ?? ''
    const category = str(url.searchParams.get('category'), 20)?.toLowerCase() ?? ''
    const maxPriceRaw = Number(url.searchParams.get('max_price'))
    const maxPrice = Number.isFinite(maxPriceRaw) && maxPriceRaw > 0 ? maxPriceRaw : null

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)
    const all = await loadCatalogue(supabase, orgId)

    const wantedTags = new Set([...matchOccasions(q), ...matchOccasions(occasionParam)])
    const terms = q.split(/\s+/).filter((w) => w.length > 2)

    const scored = all
      .filter((p) => (category ? p.category === category : true))
      .filter((p) => (maxPrice !== null && p.category === 'box' ? Number(p.price) <= maxPrice : true))
      .map((p) => {
        const hay = `${p.name} ${p.description ?? ''} ${JSON.stringify(p.contents)} ${p.occasions.join(' ')}`.toLowerCase()
        let score = 0
        for (const w of terms) if (hay.includes(w)) score += 2
        for (const tag of wantedTags) if (p.occasions.includes(tag)) score += 3
        if (p.name.toLowerCase().includes(q) && q) score += 5
        if (p.category === 'box') score += 1
        if (p.track_stock && p.stock_on_hand <= 0) score -= 4
        return { p, score }
      })

    const anyMatch = scored.some((s) => s.score > 1)
    const picked = (anyMatch ? scored.filter((s) => s.score > 1) : scored)
      .sort((a, b) => b.score - a.score || Number(a.p.price) - Number(b.p.price))
      .slice(0, 12)
      .map((s) => describeProduct(s.p))

    const cheapest = all.filter((p) => p.category === 'box').reduce((m, p) => Math.min(m, Number(p.price)), Infinity)
    const dearest = all.filter((p) => p.category === 'box').reduce((m, p) => Math.max(m, Number(p.price)), 0)

    return jsonOk(request, {
      success: true,
      count: picked.length,
      products: picked,
      shop_range: Number.isFinite(cheapest) ? `Single boxes run ${cheapest} to ${dearest} dollars in the shop.` : null,
      corporate: 'Corporate and event programmes start at $225 a box (Prestige), $295 (Luxe) or from $395 (Grand), twelve box minimum, branding from fifty boxes. Prices hold at every quantity.',
      concierge: 'Gifting Concierge memberships: Essential $199 a month (up to 2 sends), Professional $449 (up to 5), Executive $899 (up to 10). Boxes bill at list price; ground shipping is included.',
    })
  })
}

/** Some tool runners only POST; accept the same parameters as a JSON body. */
export async function POST(request: Request) {
  let params = new URLSearchParams()
  try {
    const body = await request.json()
    if (body && typeof body === 'object') {
      params = new URLSearchParams(
        Object.entries(body as Record<string, unknown>)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)])
      )
    }
  } catch {
    // no body: same as a bare GET
  }
  const url = new URL(request.url)
  url.search = params.toString()
  return GET(new Request(url, { method: 'GET', headers: request.headers }))
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
