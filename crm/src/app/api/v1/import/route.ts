import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSession } from '@/lib/api-auth'

const ENTITY_TYPES = ['contacts', 'companies', 'deals'] as const
const MAX_RECORDS = 5000

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    if (!session.ok) return session.response
    const { ctx } = session

    const { entityType, records } = await request.json()

    if (!entityType || !records) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 })
    }

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'records must be a non-empty array' }, { status: 400 })
    }
    if (records.length > MAX_RECORDS) {
      return NextResponse.json({ error: `Too many records (max ${MAX_RECORDS})` }, { status: 400 })
    }

    // Force every row into the caller's organization; never trust ids/org from the client
    const rows = records
      .filter((r: unknown) => r && typeof r === 'object' && !Array.isArray(r))
      .map((r: Record<string, unknown>) => {
        const { id: _id, organization_id: _org, ...rest } = r
        void _id
        void _org
        return { ...rest, organization_id: ctx.organizationId }
      })

    const supabase = createAdminClient()

    // Insert in batches
    const batchSize = 100
    let imported = 0
    let errors = 0

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { error } = await supabase.from(entityType).insert(batch)

      if (error) {
        errors += batch.length
        console.error(`Import batch error (${entityType}):`, error)
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
