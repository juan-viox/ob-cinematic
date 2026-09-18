import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/v1/proposals/number
 *
 * The next proposal number for the caller's organisation. The counter lives
 * in document_counters and is bumped atomically, so two people drafting at
 * the same moment cannot land on PR-0007 twice (which counting rows would).
 */
export async function POST() {
  const session = await requireSession()
  if (!session.ok) return session.response

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('next_document_number', {
    p_org: session.ctx.organizationId,
    p_kind: 'proposal',
    p_prefix: 'PR',
  })

  if (error || typeof data !== 'string') {
    console.error('[proposals/number]', error?.message)
    return NextResponse.json({ error: 'Could not allocate a proposal number' }, { status: 500 })
  }
  return NextResponse.json({ number: data })
}
