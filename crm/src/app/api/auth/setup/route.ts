import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import crmConfig from '@/crm.config'

/**
 * POST /api/auth/setup
 *
 * Creates the caller's profile. The user is derived from the session cookie —
 * any userId in the body is ignored.
 *
 * Bootstrap rule: if no profile exists yet, the caller becomes 'owner' and the
 * organization (slug from crm.config) + default deal stages are created.
 * Otherwise a caller without a profile is rejected (invite-only).
 * Idempotent: a caller that already has a profile gets 200.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let fullName: string | null = null
    try {
      const body = await request.json()
      if (typeof body?.fullName === 'string') fullName = body.fullName.trim().slice(0, 200) || null
    } catch {
      // body is optional
    }
    if (!fullName) {
      const meta = user.user_metadata?.full_name
      fullName = typeof meta === 'string' && meta.trim() ? meta.trim().slice(0, 200) : null
    }

    const admin = createAdminClient()

    // Idempotent: profile already exists
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, organization_id, role')
      .eq('id', user.id)
      .maybeSingle()

    if (existingProfile) {
      return NextResponse.json({ success: true, existing: true, role: existingProfile.role })
    }

    // Bootstrap rule: only the very first account may self-provision
    const { count, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })

    if (countError) {
      console.error('setup: profile count error', countError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Invite only. Ask an owner to invite you from Settings → Team.' },
        { status: 403 }
      )
    }

    // Find or create the organization (slug from crm.config — never "first org")
    let orgId: string
    const { data: existingOrg } = await admin
      .from('organizations')
      .select('id')
      .eq('slug', crmConfig.slug)
      .maybeSingle()

    if (existingOrg) {
      orgId = existingOrg.id
    } else {
      const { data: newOrg, error: orgError } = await admin
        .from('organizations')
        .insert({ name: crmConfig.name, slug: crmConfig.slug })
        .select('id')
        .single()

      if (orgError || !newOrg) {
        console.error('setup: organization insert error', orgError)
        return NextResponse.json({ error: 'Could not create organization' }, { status: 500 })
      }
      orgId = newOrg.id
    }

    // First account becomes owner
    const { error: profileError } = await admin.from('profiles').insert({
      id: user.id,
      organization_id: orgId,
      full_name: fullName,
      role: 'owner',
    })

    if (profileError) {
      if (profileError.code === '23505') {
        // Two possible unique violations:
        //  - profiles_pkey: this same user retried concurrently → their profile exists → 200
        //  - profiles_one_owner_per_org (006): another account won the bootstrap race
        //    and is already the owner → this caller is NOT allowed in → 403
        const { data: nowExisting } = await admin
          .from('profiles')
          .select('id, role')
          .eq('id', user.id)
          .maybeSingle()
        if (nowExisting) {
          return NextResponse.json({ success: true, existing: true, role: nowExisting.role })
        }
        return NextResponse.json(
          { error: 'Invite only. Ask an owner to invite you from Settings → Team.' },
          { status: 403 }
        )
      }
      console.error('setup: profile insert error', profileError)
      return NextResponse.json({ error: 'Could not create profile' }, { status: 500 })
    }

    // Seed default deal stages if the org has none
    const { data: existingStages } = await admin
      .from('deal_stages')
      .select('id')
      .eq('organization_id', orgId)
      .limit(1)

    if (!existingStages || existingStages.length === 0) {
      const stages = crmConfig.settings.defaultDealStages.map((s) => ({
        organization_id: orgId,
        name: s.name,
        color: s.color,
        sort_order: s.sort_order,
        is_won: s.is_won ?? false,
        is_lost: s.is_lost ?? false,
      }))
      const { error: stagesError } = await admin.from('deal_stages').insert(stages)
      if (stagesError) console.error('setup: deal_stages seed error', stagesError)
    }

    return NextResponse.json({ success: true, bootstrapped: true, role: 'owner' })
  } catch (err) {
    console.error('setup error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
