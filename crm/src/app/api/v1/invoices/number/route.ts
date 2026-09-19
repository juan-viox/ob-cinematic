import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/v1/invoices/number
 *
 * The next invoice number for the caller's organisation, OB-0141 and up.
 * The counter lives in document_counters and is bumped atomically, so two
 * people drafting at the same moment cannot both get the same number, which
 * counting rows (the previous approach) could not guarantee. The counter was
 * seeded at 141 so the CRM continues the sequence the business already used
 * before it: Invoice 0140 was the last one issued by hand.
 */
export async function POST() {
  const session = await requireSession()
  if (!session.ok) return session.response

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('next_document_number', {
    p_org: session.ctx.organizationId,
    p_kind: 'invoice',
    p_prefix: 'OB',
  })

  if (error || typeof data !== 'string') {
    console.error('[invoices/number]', error?.message)
    return NextResponse.json({ error: 'Could not allocate an invoice number' }, { status: 500 })
  }
  return NextResponse.json({ number: data })
}
