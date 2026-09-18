import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type Role = 'owner' | 'admin' | 'member'

export interface SessionContext {
  userId: string
  email: string | null
  organizationId: string
  role: Role
}

export type SessionResult =
  | { ok: true; ctx: SessionContext }
  | { ok: false; response: NextResponse }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

/**
 * Require a Supabase session (cookie-based) for an API route handler.
 * Resolves the caller's profile (organization + role) with the admin client
 * so the route can scope every read/write to the caller's organization.
 */
export async function requireSession(): Promise<SessionResult> {
  let userId: string | null = null
  let email: string | null = null

  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      userId = user.id
      email = user.email ?? null
    }
  } catch {
    userId = null
  }

  if (!userId) {
    return { ok: false, response: jsonError('Unauthorized', 401) }
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .maybeSingle()

  if (!profile?.organization_id) {
    return { ok: false, response: jsonError('No profile for this account. Accounts are invite-only.', 403) }
  }

  const role: Role = profile.role === 'owner' || profile.role === 'admin' ? profile.role : 'member'

  return {
    ok: true,
    ctx: { userId, email, organizationId: profile.organization_id, role },
  }
}

/** Require a session whose role is one of `roles`. */
export async function requireRole(roles: Role[]): Promise<SessionResult> {
  const session = await requireSession()
  if (!session.ok) return session
  if (!roles.includes(session.ctx.role)) {
    return { ok: false, response: jsonError('Forbidden', 403) }
  }
  return session
}
