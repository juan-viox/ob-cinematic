import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSession } from '@/lib/api-auth'

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    if (!session.ok) return session.response
    const { ctx } = session
    const orgId = ctx.organizationId

    const { survivorId, duplicateId, selectedFields } = await request.json()

    if (!survivorId || !duplicateId || typeof survivorId !== 'string' || typeof duplicateId !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (survivorId === duplicateId) {
      return NextResponse.json({ error: 'Cannot merge a contact into itself' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // 1. Get both contacts (scoped to the caller's organization) for the merge log
    const [{ data: survivor }, { data: duplicate }] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', survivorId).eq('organization_id', orgId).maybeSingle(),
      supabase.from('contacts').select('*').eq('id', duplicateId).eq('organization_id', orgId).maybeSingle(),
    ])

    if (!survivor || !duplicate) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // 2. Update survivor with selected fields (never allow id / org to change)
    if (selectedFields && typeof selectedFields === 'object' && !Array.isArray(selectedFields)) {
      const { id: _id, organization_id: _org, ...fields } = selectedFields as Record<string, unknown>
      void _id
      void _org
      if (Object.keys(fields).length > 0) {
        await supabase.from('contacts').update(fields).eq('id', survivorId).eq('organization_id', orgId)
      }
    }

    // 3. Transfer all related records from duplicate to survivor
    await Promise.all([
      // Activities
      supabase
        .from('activities')
        .update({ contact_id: survivorId })
        .eq('contact_id', duplicateId)
        .eq('organization_id', orgId),
      // Deals
      supabase
        .from('deals')
        .update({ contact_id: survivorId })
        .eq('contact_id', duplicateId)
        .eq('organization_id', orgId),
      // Notes
      supabase
        .from('notes')
        .update({ entity_id: survivorId })
        .eq('entity_type', 'contact')
        .eq('entity_id', duplicateId)
        .eq('organization_id', orgId),
      // Entity tags (no organization_id column; entity ownership verified above)
      supabase
        .from('entity_tags')
        .update({ entity_id: survivorId })
        .eq('entity_type', 'contact')
        .eq('entity_id', duplicateId),
      // Documents
      supabase
        .from('documents')
        .update({ contact_id: survivorId })
        .eq('contact_id', duplicateId)
        .eq('organization_id', orgId),
      // Invoices
      supabase
        .from('invoices')
        .update({ contact_id: survivorId })
        .eq('contact_id', duplicateId)
        .eq('organization_id', orgId),
    ])

    // 4. Delete the duplicate contact
    await supabase.from('contacts').delete().eq('id', duplicateId).eq('organization_id', orgId)

    // 5. Log the merge as an activity
    await supabase.from('activities').insert({
      organization_id: orgId,
      contact_id: survivorId,
      user_id: ctx.userId,
      type: 'note',
      title: 'Contacts merged',
      description: `Merged "${duplicate.first_name} ${duplicate.last_name}" (${duplicate.email ?? 'no email'}) into this contact. All activities, deals, notes, and tags were transferred.`,
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        action: 'contact_merge',
        merged_contact_id: duplicateId,
        merged_contact_name: `${duplicate.first_name} ${duplicate.last_name}`,
        merged_contact_email: duplicate.email,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Merged "${duplicate.first_name} ${duplicate.last_name}" into "${survivor.first_name} ${survivor.last_name}"`,
    })
  } catch (err) {
    console.error('Merge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
