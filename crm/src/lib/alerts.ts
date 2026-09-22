/**
 * Telling the team something arrived, on two channels at once.
 *
 * The rule that shapes everything here: an alert must never be able to lose
 * the thing it is alerting about. A paid order is money already taken, and a
 * Resend outage at the wrong moment must not turn that into a 500 that makes
 * the shop retry, or worse, drop it. So every function in this file swallows
 * its own failures, logs them, and returns. The order is already saved by the
 * time any of this runs.
 *
 * Two channels, because they fail differently. Email reaches somebody who is
 * not looking at the CRM, but gets buried. The in-app alert cannot be buried,
 * but only works if somebody is logged in. Neither alone is "we never miss an
 * order inquiry"; together they are close enough.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Where an inquiry alert goes. Comma separated, set per environment. */
export function alertRecipients(): string[] {
  const raw = process.env.ALERT_EMAILS?.trim()
  if (!raw) return []
  return [...new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('@'))
  )]
}

/**
 * The address alerts are sent FROM.
 *
 * Deliberately the transactional sender, not the campaign one. These are
 * internal messages to our own staff, so they belong on the domain whose
 * reputation we control by never cold-mailing from it; routing them through
 * the campaign subdomain would mix staff mail in with outreach and mean a
 * stranger's spam complaint could bury our own order alerts.
 */
function alertFrom(): string | null {
  return process.env.RESEND_FROM_EMAIL?.trim() || null
}

/** The kinds of thing worth interrupting somebody for. */
export type AlertKind = 'order' | 'lead' | 'booking' | 'voice_call'

/** How the in-app bell should label it. Constrained by the notifications CHECK. */
const NOTIFICATION_TYPE: Record<AlertKind, string> = {
  order: 'new_order',
  lead: 'new_lead',
  booking: 'new_booking',
  voice_call: 'voice_call',
}

const KIND_LABEL: Record<AlertKind, string> = {
  order: 'New order',
  lead: 'New inquiry',
  booking: 'New booking',
  voice_call: 'Call captured',
}

export interface TeamAlert {
  orgId: string
  kind: AlertKind
  /** One line: who, and what they want. */
  headline: string
  /** Label/value pairs shown as a small table in the email. */
  details?: Array<[string, string | null | undefined]>
  /** Free text under the details, e.g. the message somebody typed. */
  body?: string | null
  /** Path inside the CRM, e.g. '/orders'. Made absolute for the email. */
  path?: string | null
  /** Ties the in-app notification to a record so clicking it navigates. */
  entityType?: string | null
  entityId?: string | null
}

const ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c])
}

/** Where the CRM lives, for links inside an email. */
function crmOrigin(): string {
  const raw = process.env.CRM_PUBLIC_URL?.trim() || 'https://crm.occasionsbox.com'
  return raw.replace(/\/+$/, '')
}

function alertHtml(alert: TeamAlert): string {
  const rows = (alert.details ?? [])
    .filter((d): d is [string, string] => typeof d[1] === 'string' && d[1].trim() !== '')
    .map(([label, value]) =>
      `<tr>` +
      `<td style="padding:4px 14px 4px 0;color:#7a7266;white-space:nowrap;vertical-align:top;">${esc(label)}</td>` +
      `<td style="padding:4px 0;color:#211c14;">${esc(value)}</td>` +
      `</tr>`
    )
    .join('')

  const link = alert.path ? `${crmOrigin()}${alert.path}` : crmOrigin()

  return (
    `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#211c14;max-width:520px;">` +
    `<p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#a08b5b;">` +
    `${esc(KIND_LABEL[alert.kind])}</p>` +
    `<p style="margin:0 0 18px;font-size:19px;font-weight:600;">${esc(alert.headline)}</p>` +
    (rows ? `<table style="border-collapse:collapse;font-size:14px;margin-bottom:18px;">${rows}</table>` : '') +
    (alert.body
      ? `<div style="padding:12px 14px;background:#f6f3ee;border-radius:8px;font-size:14px;` +
        `white-space:pre-wrap;margin-bottom:20px;">${esc(alert.body.slice(0, 2000))}</div>`
      : '') +
    `<a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#211c14;color:#fff;` +
    `text-decoration:none;border-radius:8px;font-size:14px;">Open in the CRM</a>` +
    `<p style="margin:22px 0 0;font-size:12px;color:#8a8175;">` +
    `Sent by the Occasions Box CRM because this arrived through the website, the phone or a form. ` +
    `It is not a marketing email and has no unsubscribe link; to change who receives these, ` +
    `change ALERT_EMAILS on the ob-crm project.</p>` +
    `</div>`
  )
}

function alertText(alert: TeamAlert): string {
  const rows = (alert.details ?? [])
    .filter((d): d is [string, string] => typeof d[1] === 'string' && d[1].trim() !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
  const link = alert.path ? `${crmOrigin()}${alert.path}` : crmOrigin()
  return [
    `${KIND_LABEL[alert.kind]}: ${alert.headline}`,
    rows,
    alert.body ? `\n${alert.body.slice(0, 2000)}` : '',
    `\nOpen in the CRM: ${link}`,
  ].filter(Boolean).join('\n')
}

/**
 * Emails the alert. Returns how many addresses it reached.
 *
 * One request per recipient rather than one with several `to` addresses, so
 * that a single bad address cannot suppress the alert for everybody else.
 * Three requests is nothing; missing an order because somebody fat-fingered
 * a mailbox is not.
 */
async function emailAlert(alert: TeamAlert): Promise<number> {
  const key = process.env.RESEND_API_KEY?.trim()
  const from = alertFrom()
  const to = alertRecipients()

  if (!key || !from || to.length === 0) {
    console.warn(
      '[alerts] email skipped:',
      !key ? 'no RESEND_API_KEY' : !from ? 'no RESEND_FROM_EMAIL' : 'no ALERT_EMAILS'
    )
    return 0
  }

  const subject = `${KIND_LABEL[alert.kind]}: ${alert.headline}`.slice(0, 120)
  const html = alertHtml(alert)
  const text = alertText(alert)

  let sent = 0
  for (const address of to) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [address], subject, html, text }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) sent++
      else console.error('[alerts] Resend refused for', address, res.status)
    } catch (err) {
      console.error('[alerts] email failed for', address, err instanceof Error ? err.message : err)
    }
  }
  return sent
}

/** Puts the alert on every team member's bell. */
async function bellAlert(supabase: SupabaseClient, alert: TeamAlert): Promise<number> {
  try {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id')
      .eq('organization_id', alert.orgId)

    if (!profiles?.length) return 0

    const rows = profiles.map((p) => ({
      user_id: p.id as string,
      type: NOTIFICATION_TYPE[alert.kind],
      title: alert.headline.slice(0, 200),
      message: (alert.details ?? [])
        .filter((d): d is [string, string] => typeof d[1] === 'string' && d[1].trim() !== '')
        .map(([label, value]) => `${label}: ${value}`)
        .join(' · ')
        .slice(0, 400) || null,
      entity_type: alert.entityType ?? null,
      entity_id: alert.entityId ?? null,
    }))

    const { error } = await supabase.from('notifications').insert(rows)
    if (error) {
      console.error('[alerts] bell insert failed:', error.message)
      return 0
    }
    return rows.length
  } catch (err) {
    console.error('[alerts] bell failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Raises an alert on both channels.
 *
 * Never throws. The caller has already saved the thing being alerted about,
 * and an alert that fails is a problem to read in the logs, not a reason to
 * fail the request that took somebody's money.
 */
export async function notifyTeam(
  supabase: SupabaseClient,
  alert: TeamAlert
): Promise<{ emailed: number; belled: number }> {
  const [emailed, belled] = await Promise.all([
    emailAlert(alert).catch((err) => {
      console.error('[alerts] email threw:', err instanceof Error ? err.message : err)
      return 0
    }),
    bellAlert(supabase, alert),
  ])
  if (emailed === 0 && belled === 0) {
    console.error('[alerts] NOTHING DELIVERED for', alert.kind, alert.headline)
  }
  return { emailed, belled }
}
