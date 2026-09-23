import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { probeStripe } from '@/lib/stripe'

/**
 * GET /api/v1/stripe/check
 *
 * Would a card payment actually become an order.
 *
 * The Integrations page can already say that both Stripe variables are set.
 * That is a weaker claim than it looks: a valid signing secret can belong to
 * an endpoint pointing at somewhere else entirely, and nothing on this side
 * can tell, because the webhook that would have complained is exactly the
 * thing that never arrives. The symptom is a customer who paid and an Orders
 * page that stays empty.
 *
 * So this asks Stripe which endpoints it actually has, where they point and
 * what they listen for. Reads only. Takes no money, creates nothing, and
 * never returns either key.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireSession()
  if (!session.ok) return session.response

  const probe = await probeStripe()
  return NextResponse.json({ probe }, { headers: { 'Cache-Control': 'no-store' } })
}
