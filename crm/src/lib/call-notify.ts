/**
 * The email the team gets after every call Olivia takes.
 *
 * Kari and Juan will not always pick up a transfer, and a caller who only
 * asked a question leaves nothing behind in the pipeline. So every finished
 * conversation, whatever came of it, is mailed to the team with the caller,
 * the summary, what Olivia did about it and the transcript, and the follow
 * up is one reply away.
 *
 * Sent through Resend. RESEND_API_KEY and RESEND_FROM_EMAIL are required;
 * CALL_NOTIFY_EMAILS (comma separated) names the recipients and falls back
 * to the business address in crm.config. Never fatal: the call is already in
 * the CRM, and a missing email is a logged line, not a lost call.
 */
import crmConfig from '@/crm.config'

export interface CallNotice {
  conversationId: string
  kind: 'call' | 'chat'
  startedAt: string
  durationSecs: number | null
  callerPhone: string | null
  callerName: string | null
  callerEmail: string | null
  title: string | null
  summary: string | null
  transcript: string
  toolsUsed: string[]
  callSuccessful: string | null
  contactId: string | null
  activityId: string | null
}

const TRANSCRIPT_CHARS = 6000

function recipients(): string[] {
  const raw = process.env.CALL_NOTIFY_EMAILS ?? crmConfig.email ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** What Olivia did, in the team's words rather than tool names. */
export function outcomeOf(toolsUsed: string[]): string {
  const did: string[] = []
  if (toolsUsed.includes('transfer_to_number')) did.push('tried to transfer the call')
  if (toolsUsed.includes('request_callback')) did.push('booked a call back')
  if (toolsUsed.includes('create_opportunity')) did.push('opened an opportunity in the pipeline')
  if (did.length === 0) return 'Nothing was booked: this one needs a human follow up if it mattered.'
  return `Olivia ${did.join(', ')}.`
}

function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  return (raw && raw.replace(/\/admin\/?$/, '').replace(/\/$/, '')) || 'https://crm.occasionsbox.com'
}

export function renderCallNotice(n: CallNotice): { subject: string; text: string; html: string } {
  const who = n.callerName || n.callerPhone || n.callerEmail || 'Unknown caller'
  const needsFollowUp = !n.toolsUsed.includes('create_opportunity') && !n.toolsUsed.includes('request_callback')
  const subject = `${needsFollowUp ? 'Follow up: ' : ''}Olivia ${n.kind} from ${who}${n.title ? ` - ${n.title}` : ''}`
  const when = new Date(n.startedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const duration = n.durationSecs !== null ? `${Math.max(1, Math.round(n.durationSecs / 60))} min` : null
  const link = n.contactId ? `${appUrl()}/contacts/${n.contactId}` : `${appUrl()}/activities`

  const facts: Array<[string, string | null]> = [
    ['When', `${when} ET${duration ? `, ${duration}` : ''}`],
    ['Caller', n.callerName],
    ['Phone', n.callerPhone],
    ['Email', n.callerEmail],
    ['Outcome', outcomeOf(n.toolsUsed)],
  ]
  const shown = facts.filter((f): f is [string, string] => Boolean(f[1]))
  const transcript = n.transcript.length > TRANSCRIPT_CHARS
    ? `${n.transcript.slice(0, TRANSCRIPT_CHARS)}\n[transcript shortened]`
    : n.transcript

  const text = [
    ...shown.map(([k, v]) => `${k}: ${v}`),
    '',
    n.summary ? `Summary\n${n.summary}` : 'No summary was produced for this conversation.',
    '',
    `In the CRM: ${link}`,
    '',
    transcript ? `Transcript\n${transcript}` : '',
  ].join('\n').trim()

  const rows = shown
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`)
    .join('')
  const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">
  <p style="margin:0 0 12px;font-size:17px"><b>${escapeHtml(subject)}</b></p>
  <table style="border-collapse:collapse;margin:0 0 16px">${rows}</table>
  <p style="margin:0 0 16px">${n.summary ? escapeHtml(n.summary) : '<i>No summary was produced for this conversation.</i>'}</p>
  <p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="color:#B8860B">Open in the CRM</a></p>
  ${transcript ? `<p style="margin:0 0 6px;color:#666;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Transcript</p><pre style="white-space:pre-wrap;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#f6f4ee;padding:12px;border-radius:6px;margin:0">${escapeHtml(transcript)}</pre>` : ''}
</div>`.trim()

  return { subject, text, html }
}

/** true when the email went out; false, with a logged reason, otherwise. */
export async function sendCallNotice(notice: CallNotice): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  const to = recipients()
  if (!key || !from) {
    console.warn('[call-notify] RESEND_API_KEY / RESEND_FROM_EMAIL not set; call email skipped')
    return false
  }
  if (to.length === 0) {
    console.warn('[call-notify] no recipients (CALL_NOTIFY_EMAILS or crm.config email); call email skipped')
    return false
  }
  const { subject, text, html } = renderCallNotice(notice)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        html,
        ...(notice.callerEmail ? { reply_to: notice.callerEmail } : {}),
        headers: { 'X-Entity-Ref-ID': notice.conversationId },
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[call-notify] Resend refused the email:', res.status, body.slice(0, 300))
      return false
    }
    return true
  } catch (err) {
    console.error('[call-notify] Resend error:', err instanceof Error ? err.message : err)
    return false
  }
}
