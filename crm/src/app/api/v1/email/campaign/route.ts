import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  CAMPAIGN_SENDER_HELP,
  campaignFrom,
  campaignHtml,
  recipientsForTag,
  renderMerge,
  skipReason,
  unsubscribeUrl,
  type CampaignRecipient,
} from '@/lib/campaign'

/**
 * One message to everyone carrying a tag, merged per recipient.
 *
 * Sent in small batches that the caller walks with an offset, rather than in
 * one request. A serverless function has a wall clock; a list of three
 * hundred would hit it halfway through and leave nobody able to say who had
 * already been written to. Batching keeps every invocation short, gives the
 * screen a real progress bar, and makes a resume after a failure a matter of
 * calling again with the same offset.
 *
 * Two rules are enforced here rather than in the UI, because the UI is not
 * the only thing that can call this: a contact who opted out is never sent
 * to, and every message carries a working unsubscribe link.
 */

/** Small enough to finish well inside the function's wall clock. */
const BATCH = 25
/** Resend's published rate limit is well above this; we stay politely under. */
const GAP_MS = 150

function originOf(request: Request): string {
  const h = request.headers
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  if (host) return `${proto}://${host}`
  return new URL(request.url).origin
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** GET: who would receive this, without sending anything. */
export async function GET(request: Request) {
  const session = await requireSession()
  if (!session.ok) return session.response
  const { ctx } = session

  const tagId = new URL(request.url).searchParams.get('tagId')
  if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 })

  const supabase = createAdminClient()
  let recipients: CampaignRecipient[]
  try {
    recipients = await recipientsForTag(supabase, ctx.organizationId, tagId)
  } catch (err) {
    console.error('[campaign:audience]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not read the audience' }, { status: 500 })
  }

  const sendable = recipients.filter((c) => skipReason(c) === null)
  return NextResponse.json({
    total: recipients.length,
    sendable: sendable.length,
    optedOut: recipients.filter((c) => skipReason(c) === 'opted_out').length,
    noEmail: recipients.filter((c) => skipReason(c) === 'no_email').length,
    // The screen shows this as a blocker before anyone writes a draft,
    // rather than letting them find out at the moment they press send.
    senderReady: campaignFrom() !== null,
    senderHelp: campaignFrom() === null ? CAMPAIGN_SENDER_HELP : null,
    // Enough of each to preview a merge and to show who is being skipped.
    recipients: recipients.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      job_title: c.job_title,
      company: c.company?.name ?? null,
      skip: skipReason(c),
    })),
  })
}

export async function POST(request: Request) {
  const session = await requireSession()
  if (!session.ok) return session.response
  const { ctx } = session

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tagId = typeof body.tagId === 'string' ? body.tagId : null
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const messageBody = typeof body.body === 'string' ? body.body.trim() : ''
  const offset = Number.isInteger(body.offset) ? (body.offset as number) : 0

  if (!tagId) return NextResponse.json({ error: 'tagId is required' }, { status: 400 })
  if (!subject) return NextResponse.json({ error: 'A subject is required' }, { status: 400 })
  if (!messageBody) return NextResponse.json({ error: 'A message is required' }, { status: 400 })
  if (offset < 0) return NextResponse.json({ error: 'offset must not be negative' }, { status: 400 })

  const resendKey = process.env.RESEND_API_KEY?.trim()
  if (!resendKey) {
    return NextResponse.json(
      { error: 'Email is not set up: RESEND_API_KEY is missing. Nothing was sent.' },
      { status: 503 }
    )
  }

  // Refused, not fallen back: see campaignFrom(). Cold outreach over the
  // transactional address is the one mistake here that is expensive and
  // slow to undo.
  const from = campaignFrom()
  if (!from) {
    return NextResponse.json({ error: CAMPAIGN_SENDER_HELP }, { status: 503 })
  }

  const supabase = createAdminClient()
  let all: CampaignRecipient[]
  try {
    all = await recipientsForTag(supabase, ctx.organizationId, tagId)
  } catch (err) {
    console.error('[campaign:send]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not read the audience' }, { status: 500 })
  }

  const origin = originOf(request)
  const batch = all.slice(offset, offset + BATCH)

  let sent = 0
  let skipped = 0
  const failures: Array<{ id: string; email: string | null; reason: string }> = []

  for (let i = 0; i < batch.length; i++) {
    const contact = batch[i]

    if (skipReason(contact) !== null) {
      skipped++
      continue
    }

    const unsubUrl = unsubscribeUrl(origin, contact.unsubscribe_token)
    const mergedSubject = renderMerge(subject, contact)
    const mergedBody = renderMerge(messageBody, contact)

    let ok = false
    let failure = 'send failed'
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [contact.email],
          subject: mergedSubject,
          html: campaignHtml(mergedBody, unsubUrl),
          text: `${mergedBody}\n\n---\nOccasions Box, Fort Lee, New Jersey\nUnsubscribe: ${unsubUrl}`,
          // RFC 8058: lets Gmail and Outlook show their own unsubscribe
          // button, which recipients use instead of the spam button.
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) {
        ok = true
      } else {
        const detail = (await res.json().catch(() => null)) as { message?: unknown } | null
        failure = typeof detail?.message === 'string' ? detail.message : `HTTP ${res.status}`
        console.error('[campaign] Resend refused:', res.status, failure)
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : 'send failed'
      console.error('[campaign] Resend error:', failure)
    }

    // Logged either way: a message that did not go out is exactly the thing
    // somebody needs to find later, and the timeline is where they look.
    await supabase.from('activities').insert({
      organization_id: ctx.organizationId,
      contact_id: contact.id,
      user_id: ctx.userId,
      type: 'email',
      title: ok ? `Campaign: ${mergedSubject}` : `Campaign not sent: ${mergedSubject}`,
      description: `To: ${contact.email}\n\n${mergedBody.substring(0, 500)}`,
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: {
        to: contact.email,
        subject: mergedSubject,
        campaign: true,
        tagId,
        sent: ok,
        ...(ok ? {} : { reason: failure }),
      },
    })

    if (ok) sent++
    else failures.push({ id: contact.id, email: contact.email, reason: failure })

    if (i < batch.length - 1) await wait(GAP_MS)
  }

  const nextOffset = offset + batch.length
  return NextResponse.json({
    ok: true,
    total: all.length,
    processed: nextOffset,
    done: nextOffset >= all.length,
    nextOffset: nextOffset >= all.length ? null : nextOffset,
    sent,
    skipped,
    failures,
  })
}
