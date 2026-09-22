import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSession } from '@/lib/api-auth'
import { ensureTag, escapeLike, tagEntity } from '@/lib/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Importing a bought or built list.
 *
 * The contacts path does three things the generic insert could not, and
 * each of them is the difference between a list that can be mailed and one
 * that cannot:
 *
 *  - It creates and links a company row, because the {{company}} merge field
 *    reads the linked company and not a string on the contact. Without this,
 *    every email in the campaign reads "we would rather not let that happen
 *    to ." and the whole send is wasted.
 *  - It is idempotent on email. contacts carries UNIQUE(organization_id,
 *    email), so a re-import used to fail the entire batch on the first
 *    address already present. Now an existing contact is filled in where it
 *    was blank, left alone where it was not, and tagged either way, so
 *    running the same file twice is safe.
 *  - It applies a tag as it goes, because a list nobody can select later is
 *    not a list, it is 200 loose contacts.
 */

const ENTITY_TYPES = ['contacts', 'companies', 'deals'] as const
type EntityType = (typeof ENTITY_TYPES)[number]

const MAX_RECORDS = 5000
const TAG_COLOUR = '#C9A227'

function text(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

/** A list from a broker is full of "n/a" and "-". None of those is a name. */
const JUNK = new Set(['n/a', 'na', 'none', '-', '--', 'unknown', 'null', 'tbd'])
function meaningful(v: unknown, max = 200): string | null {
  const s = text(v, max)
  return s && !JUNK.has(s.toLowerCase()) ? s : null
}

function emailOf(v: unknown): string | null {
  const s = text(v, 320)
  if (!s) return null
  const lower = s.toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower) ? lower : null
}

/** Finds a company by name within the org, or makes one. */
async function ensureCompany(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  extra: { phone?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null }
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', escapeLike(name))
    .limit(1)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('companies')
    .insert({
      organization_id: orgId,
      name,
      phone: extra.phone ?? null,
      address: extra.address ?? null,
      city: extra.city ?? null,
      state: extra.state ?? null,
      zip: extra.zip ?? null,
    })
    .select('id')
    .single()
  if (created?.id) return created.id as string
  console.error('[import] company insert failed:', error?.message)
  return null
}

interface ContactOutcome {
  created: number
  updated: number
  tagged: number
  failed: Array<{ row: number; reason: string }>
  companiesCreated: number
}

async function importContacts(
  supabase: SupabaseClient,
  orgId: string,
  records: Array<Record<string, unknown>>,
  tagId: string | null
): Promise<ContactOutcome> {
  const out: ContactOutcome = { created: 0, updated: 0, tagged: 0, failed: [], companiesCreated: 0 }
  const companyCache = new Map<string, string | null>()

  for (let i = 0; i < records.length; i++) {
    const row = records[i]

    const firstName = meaningful(row.first_name, 100)
    const lastName = meaningful(row.last_name, 100)
    if (!firstName && !lastName) {
      out.failed.push({ row: i + 1, reason: 'no name on this row' })
      continue
    }

    const email = emailOf(row.email)
    const companyName = meaningful(row.company, 200)
    const address = meaningful(row.address, 300)
    const city = meaningful(row.city, 120)
    const state = meaningful(row.state, 60)
    const zip = meaningful(row.zip, 20)
    const phone = meaningful(row.phone, 40)

    let companyId: string | null = null
    if (companyName) {
      const key = companyName.toLowerCase()
      if (companyCache.has(key)) {
        companyId = companyCache.get(key) ?? null
      } else {
        const before = await supabase
          .from('companies')
          .select('id')
          .eq('organization_id', orgId)
          .ilike('name', escapeLike(companyName))
          .limit(1)
          .maybeSingle()
        companyId = await ensureCompany(supabase, orgId, companyName, { phone, address, city, state, zip })
        if (!before.data?.id && companyId) out.companiesCreated++
        companyCache.set(key, companyId)
      }
    }

    // The address belongs on the company when there is one, and on the
    // contact's notes when there is not, so nothing from the file is lost.
    const noteParts = [
      meaningful(row.notes, 1000),
      !companyId && address ? [address, city, state, zip].filter(Boolean).join(', ') : null,
    ].filter(Boolean)

    const fields = {
      first_name: firstName ?? lastName!,
      last_name: firstName ? lastName : null,
      email,
      phone,
      job_title: meaningful(row.job_title, 160),
      company_id: companyId,
      notes: noteParts.length ? noteParts.join('\n') : null,
    }

    let contactId: string | null = null

    // UNIQUE(organization_id, email) makes a blind insert fail the whole
    // batch on a re-run, so look first when there is an address to look by.
    const existing = email
      ? (
          await supabase
            .from('contacts')
            .select('id, first_name, last_name, phone, job_title, company_id, notes')
            .eq('organization_id', orgId)
            .eq('email', email)
            .maybeSingle()
        ).data
      : null

    if (existing?.id) {
      // Fill the gaps; never overwrite something a human may have corrected.
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) {
        if (v === null || k === 'email') continue
        if (!(existing as Record<string, unknown>)[k]) patch[k] = v
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('contacts').update(patch).eq('id', existing.id)
        if (error) {
          out.failed.push({ row: i + 1, reason: error.message })
          continue
        }
        out.updated++
      }
      contactId = existing.id as string
    } else {
      const { data: created, error } = await supabase
        .from('contacts')
        .insert({ organization_id: orgId, source: 'import', ...fields })
        .select('id')
        .single()
      if (error || !created) {
        out.failed.push({ row: i + 1, reason: error?.message ?? 'insert failed' })
        continue
      }
      contactId = created.id as string
      out.created++
    }

    if (tagId && contactId) {
      await tagEntity(supabase, tagId, 'contact', contactId)
      out.tagged++
    }
  }

  return out
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    if (!session.ok) return session.response
    const { ctx } = session

    const body = (await request.json()) as {
      entityType?: unknown
      records?: unknown
      tagName?: unknown
    }

    const entityType = body.entityType as EntityType
    if (!entityType || !ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 })
    }
    if (!Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: 'records must be a non-empty array' }, { status: 400 })
    }
    if (body.records.length > MAX_RECORDS) {
      return NextResponse.json({ error: `Too many records (max ${MAX_RECORDS})` }, { status: 400 })
    }

    const records = body.records.filter(
      (r: unknown): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r)
    )

    const supabase = createAdminClient()

    let tagId: string | null = null
    const tagName = text(body.tagName, 60)
    if (tagName) {
      tagId = await ensureTag(supabase, ctx.organizationId, tagName, TAG_COLOUR)
      if (!tagId) {
        return NextResponse.json({ error: 'Could not create that tag; nothing was imported' }, { status: 500 })
      }
    }

    if (entityType === 'contacts') {
      const result = await importContacts(supabase, ctx.organizationId, records, tagId)
      return NextResponse.json({
        success: true,
        imported: result.created,
        updated: result.updated,
        tagged: result.tagged,
        companiesCreated: result.companiesCreated,
        errors: result.failed.length,
        // Enough to fix the file, without returning five thousand rows.
        failures: result.failed.slice(0, 25),
        tag: tagName,
      })
    }

    // Companies and deals keep the plain path: force the caller's org, never
    // trust an id or an organization_id that arrived from a browser.
    const rows = records.map((r) => {
      const { id: _id, organization_id: _org, ...rest } = r
      void _id
      void _org
      return { ...rest, organization_id: ctx.organizationId }
    })

    let imported = 0
    let errors = 0
    const batchSize = 100
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { error } = await supabase.from(entityType).insert(batch)
      if (error) {
        errors += batch.length
        console.error(`Import batch error (${entityType}):`, error.message)
      } else {
        imported += batch.length
      }
    }

    return NextResponse.json({ success: true, imported, errors })
  } catch (err) {
    console.error('import error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
