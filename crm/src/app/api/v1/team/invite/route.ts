import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/api-auth'
import { BASE_PATH } from '@/lib/url'

const ALLOWED_ROLES = ['admin', 'member'] as const
type InviteRole = (typeof ALLOWED_ROLES)[number]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Public URL the invite email should land on (host-aware, includes basePath). */
function callbackUrl(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  if (appUrl) return `${appUrl}/auth/callback`
  return `${new URL(request.url).origin}${BASE_PATH}/auth/callback`
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(['owner', 'admin'])
    if (!session.ok) return session.response
    const { ctx } = session

    let body: { email?: unknown; role?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = typeof body.role === 'string' ? body.role : ''

    if (!email || !role) {
      return NextResponse.json({ error: 'Missing required fields: email, role' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (!ALLOWED_ROLES.includes(role as InviteRole)) {
      return NextResponse.json({ error: 'Invalid role. Must be admin or member.' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Send invite via Supabase Auth
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: callbackUrl(request),
      data: {
        role,
        invited_by: ctx.userId,
        organization_id: ctx.organizationId,
      },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data.user) {
      return NextResponse.json({ error: 'Invite failed' }, { status: 500 })
    }

    // Create the invited user's profile in the inviter's organization
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: data.user.id,
        organization_id: ctx.organizationId,
        full_name: email.split('@')[0],
        role,
      },
      { onConflict: 'id' }
    )

    if (profileError) {
      console.error('invite: profile upsert error', profileError)
      return NextResponse.json(
        { error: 'Invitation sent but the profile could not be created' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Invitation sent to ${email}`,
      userId: data.user.id,
    })
  } catch (err) {
    console.error('invite error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
