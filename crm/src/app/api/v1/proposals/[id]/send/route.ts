import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import crmConfig from '@/crm.config'

/**
 * POST /api/v1/proposals/{id}/send
 *
 * Emails the client their proposal link and marks it sent. Without a Resend
 * key the email is not sent but the proposal is still marked sent and the
 * activity is logged, so the team can paste the link themselves; the response
 * says which of the two happened.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  if (!session.ok) return session.response

  const { id } = await params
  const supabase = createAdminClient()

  const { data: proposal } = await supabase
    .from('proposals')
    .select('*, contact:contacts(id, first_name, last_name, email)')
    .eq('id', id)
    .eq('organization_id', session.ctx.organizationId)
    .single()

  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const contact = proposal.contact as { id: string; first_name: string; last_name: string | null; email: string | null } | null
  if (!contact?.email) {
    return NextResponse.json({ error: 'This client has no email address on file' }, { status: 400 })
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/admin\/?$/, '') ?? new URL(request.url).origin
  const link = `${origin}${basePath}/p/${proposal.public_token}`

  const subject = `Your ${crmConfig.name} proposal ${proposal.proposal_number}`
  const body = `Hi ${contact.first_name},

Your proposal is ready to read and approve here:
${link}

It lists every box, the quantity, the price and the ship date. If it is right, press Approve on that page and we start sourcing the same day. If anything should change, just reply to this email.

Warmly,
${crmConfig.name}
${crmConfig.phone} · ${crmConfig.email}`

  const resendKey = process.env.RESEND_API_KEY
  let sent = false
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || crmConfig.email,
          to: [contact.email],
          subject,
          html: body.replace(/\n/g, '<br>'),
        }),
        signal: AbortSignal.timeout(10_000),
      })
      sent = res.ok
      if (!res.ok) console.error('[proposals/send] resend error:', res.status, await res.text().catch(() => ''))
    } catch (err) {
      console.error('[proposals/send]', err instanceof Error ? err.message : err)
    }
  }

  await supabase
    .from('proposals')
    .update({ status: proposal.status === 'draft' ? 'sent' : proposal.status, sent_at: proposal.sent_at ?? new Date().toISOString() })
    .eq('id', id)

  await supabase.from('activities').insert({
    organization_id: session.ctx.organizationId,
    contact_id: contact.id,
    deal_id: proposal.deal_id ?? null,
    user_id: session.ctx.userId,
    type: 'email',
    title: `Proposal ${proposal.proposal_number} sent to ${contact.first_name}`,
    description: sent ? `Emailed to ${contact.email}\n\n${link}` : `Not emailed (no Resend key configured). Send this link by hand:\n${link}`,
    status: 'completed',
    completed_at: new Date().toISOString(),
    metadata: { proposal_id: id, link, sent_via: sent ? 'resend' : 'logged_only' },
  })

  return NextResponse.json({
    success: true,
    sent,
    link,
    message: sent
      ? `Emailed to ${contact.email}`
      : 'Marked as sent and logged. Add a Resend API key to send it automatically, or copy the link and send it yourself.',
  })
}
