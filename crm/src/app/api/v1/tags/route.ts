import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureTag, tagEntity } from '@/lib/ingest'

/**
 * Tags, from the screen rather than from an import.
 *
 * The tables have existed since the first migration and nothing in the UI
 * ever touched them, so every tag in the database arrived through an ingest
 * route or a bulk load. This is what lets somebody put one on by hand.
 *
 * It exists as a route rather than a direct table write from the browser
 * because creating a tag needs the caller's organization_id, and the browser
 * has no honest way to know it. Row level security would reject a guess; the
 * session knows the truth.
 */

const ENTITY_TYPES = ['contact', 'company', 'deal'] as const
type EntityType = (typeof ENTITY_TYPES)[number]

const DEFAULT_COLOUR = '#C9A227'

/** GET: every tag in the org, with how many things carry it. */
export async function GET() {
  const session = await requireSession()
  if (!session.ok) return session.response
  const { ctx } = session

  const supabase = createAdminClient()
  const { data: tags, error } = await supabase
    .from('tags')
    .select('id, name, color')
    .eq('organization_id', ctx.organizationId)
    .order('name')
  if (error) {
    console.error('[tags:list]', error.message)
    return NextResponse.json({ error: 'Could not read tags' }, { status: 500 })
  }

  const ids = (tags ?? []).map((t) => t.id as string)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: links } = await supabase
      .from('entity_tags')
      .select('tag_id')
      .in('tag_id', ids)
    for (const l of (links ?? []) as Array<{ tag_id: string }>) {
      counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1)
    }
  }

  return NextResponse.json({
    tags: (tags ?? []).map((t) => ({ ...t, count: counts.get(t.id as string) ?? 0 })),
  })
}

/**
 * POST: put a tag on something, or take it off.
 * Body: { name, entityType, entityId, action?: 'add' | 'remove' }
 */
export async function POST(request: Request) {
  const session = await requireSession()
  if (!session.ok) return session.response
  const { ctx } = session

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  const entityType = body.entityType as EntityType
  const entityId = typeof body.entityId === 'string' ? body.entityId : ''
  const action = body.action === 'remove' ? 'remove' : 'add'

  if (!name) return NextResponse.json({ error: 'A tag name is required' }, { status: 400 })
  if (!ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json({ error: `entityType must be one of ${ENTITY_TYPES.join(', ')}` }, { status: 400 })
  }
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })

  const supabase = createAdminClient()

  // The entity has to be ours. entity_tags carries no organization_id of its
  // own, so without this check a known id from another org could be tagged.
  const table = entityType === 'contact' ? 'contacts' : entityType === 'company' ? 'companies' : 'deals'
  const { data: owned } = await supabase
    .from(table)
    .select('id')
    .eq('id', entityId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'remove') {
    const { data: tag } = await supabase
      .from('tags')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('name', name)
      .maybeSingle()
    if (tag?.id) {
      await supabase
        .from('entity_tags')
        .delete()
        .eq('tag_id', tag.id)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
    }
    // The tag itself stays even when nothing carries it any more: somebody
    // named it deliberately, and a campaign audience may be rebuilt from it.
    return NextResponse.json({ ok: true, removed: name })
  }

  const tagId = await ensureTag(supabase, ctx.organizationId, name, DEFAULT_COLOUR)
  if (!tagId) return NextResponse.json({ error: 'Could not create that tag' }, { status: 500 })
  await tagEntity(supabase, tagId, entityType, entityId)

  return NextResponse.json({ ok: true, tag: { id: tagId, name, color: DEFAULT_COLOUR } })
}
