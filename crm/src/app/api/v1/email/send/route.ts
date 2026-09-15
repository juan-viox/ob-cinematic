import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSession } from '@/lib/api-auth'

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    if (!session.ok) return session.response
    const { ctx } = session

    const { to, subject, body, contactId } = await request.json()

    if (!to || !subject || !body || typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Only link to a contact that belongs to the caller's organization
    let linkedContactId: string | null = null
    if (contactId && typeof contactId === 'string') {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('organization_id', ctx.organizationId)
        .maybeSingle()
      if (!contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      }
      linkedContactId = contact.id
    }

    // Try sending via Resend if key is configured
    const resendKey = process.env.RESEND_API_KEY
    let emailSent = false

    if (resendKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'noreply@occasionsbox.com',
            to: [to],
            subject,
            html: body.replace(/\n/g, '<br/>'),
          }),
        })

        if (res.ok) {
          emailSent = true
        } else {
          const err = await res.json().catch(() => null)
          console.error('Resend error:', err)
        }
      } catch (err) {
        console.error('Resend API error:', err)
      }
    }

    // Log email as activity regardless of send status
    await supabase.from('activities').insert({
      organization_id: ctx.organizationId,
      contact_id: linkedContactId,
      user_id: ctx.userId,
      type: 'email',
      title: `Email: ${subject}`,
      description: `To: ${to}\n\n${body.substring(0, 500)}`,
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        to,
        subject,
        sent_via: emailSent ? 'resend' : 'logged_only',
        sent_at: new Date().toISOString(),
      },
    })

    return NextResponse.json({
      success: true,
      sent: emailSent,
      message: emailSent
        ? 'Email sent successfully'
        : 'Email logged as activity (no Resend API key configured)',
    })
  } catch (err) {
    console.error('email/send error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
