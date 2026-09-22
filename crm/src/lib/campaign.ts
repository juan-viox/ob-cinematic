/**
 * Bulk outreach: merging one message into many, and the opt-out that has to
 * ride along with it.
 *
 * Everything here is deliberately small and pure so the campaign route can
 * be read in one sitting. The rules that matter live in this file rather
 * than in the route, because they are the ones that must never drift:
 * a contact who opted out is never sent to, and every message carries a
 * working unsubscribe link.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** The fields a campaign body may reference. Anything else is left alone. */
export interface MergeContact {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  job_title?: string | null
  company?: { name?: string | null } | null
}

/**
 * Substitutes {{first_name}} and friends.
 *
 * An unknown placeholder is left exactly as written rather than blanked: a
 * visible {{ceo_name}} in a draft is a typo someone catches, whereas a silent
 * empty string is a sentence that ends in a comma and nobody notices until
 * two hundred of them have gone out.
 */
export function renderMerge(template: string, contact: MergeContact): string {
  const values: Record<string, string> = {
    first_name: (contact.first_name ?? '').trim(),
    last_name: (contact.last_name ?? '').trim(),
    email: (contact.email ?? '').trim(),
    job_title: (contact.job_title ?? '').trim(),
    company: (contact.company?.name ?? '').trim(),
  }
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase()
    return key in values ? values[key] : whole
  })
}

/**
 * The placeholders a body uses that we cannot fill for a given contact.
 * The campaign screen calls this before sending so "Hi ," is caught while
 * it is still a draft.
 */
export function missingMergeFields(template: string, contact: MergeContact): string[] {
  const used = new Set<string>()
  for (const m of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) used.add(m[1].toLowerCase())
  const missing: string[] = []
  for (const key of used) {
    const filled = renderMerge(`{{${key}}}`, contact)
    if (filled === '' || filled === `{{${key}}}`) missing.push(key)
  }
  return missing.sort()
}

/** Where the unsubscribe link points. Absolute, because it lives in an inbox. */
export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/api/v1/unsubscribe?t=${encodeURIComponent(token)}`
}

/**
 * The sender for cold outreach, which must never be the address that sends
 * order confirmations.
 *
 * A stranger who did not ask to hear from us reports spam far more often
 * than a customer reading their receipt, and mailbox providers score that
 * reputation per sending domain. Share one domain between the two and a bad
 * campaign puts order confirmations and tracking into junk folders, which
 * costs far more than the campaign was ever worth.
 *
 * So this returns null rather than falling back. A warning on a screen gets
 * clicked past at eleven at night; a campaign that will not send until the
 * separate sender exists cannot be.
 */
export function campaignFrom(): string | null {
  return process.env.RESEND_CAMPAIGN_FROM_EMAIL?.trim() || null
}

/** What to tell somebody who has not set the campaign sender up yet. */
export const CAMPAIGN_SENDER_HELP =
  'Campaigns need their own sending domain so a spam complaint can never reach the address ' +
  'that sends order confirmations. Verify a subdomain such as hello.occasionsbox.com in Resend, ' +
  'then set RESEND_CAMPAIGN_FROM_EMAIL on the ob-crm project in Vercel. Nothing was sent.'

/** Plain text to the minimal HTML Resend sends, with the opt-out footer. */
export function campaignHtml(body: string, unsubUrl: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    `<div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.6;color:#211c14;">` +
    escaped.replace(/\n/g, '<br/>') +
    `</div>` +
    `<hr style="border:0;border-top:1px solid #ddd;margin:28px 0 12px;"/>` +
    `<div style="font-family:Arial,sans-serif;font-size:12px;color:#777;line-height:1.5;">` +
    `Occasions Box, Fort Lee, New Jersey<br/>` +
    `You received this because we believe gifting is part of your work. ` +
    `<a href="${unsubUrl}" style="color:#777;">Unsubscribe</a> and we will not write again.` +
    `</div>`
  )
}

export type SkipReason = 'no_email' | 'opted_out'

export interface CampaignRecipient {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  email_opt_out: boolean
  unsubscribe_token: string
  company: { name: string | null } | null
}

/** Why a contact on the list is not getting this message. */
export function skipReason(c: CampaignRecipient): SkipReason | null {
  if (c.email_opt_out) return 'opted_out'
  if (!c.email || !c.email.includes('@')) return 'no_email'
  return null
}

/** Everyone carrying a tag, with what a merge and an opt-out check both need. */
export async function recipientsForTag(
  supabase: SupabaseClient,
  orgId: string,
  tagId: string
): Promise<CampaignRecipient[]> {
  const { data: links, error: linkError } = await supabase
    .from('entity_tags')
    .select('entity_id')
    .eq('tag_id', tagId)
    .eq('entity_type', 'contact')
  if (linkError) throw new Error(linkError.message)

  const ids = (links ?? []).map((l) => l.entity_id as string)
  if (!ids.length) return []

  // Scoped to the org as well as the tag: entity_tags carries no
  // organization_id of its own, so the contacts read is what enforces it.
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, first_name, last_name, job_title, email_opt_out, unsubscribe_token, company:companies(name)')
    .eq('organization_id', orgId)
    .in('id', ids)
    .order('first_name')
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const r = row as unknown as Omit<CampaignRecipient, 'company'> & {
      company: { name: string | null } | { name: string | null }[] | null
    }
    return {
      ...r,
      company: Array.isArray(r.company) ? (r.company[0] ?? null) : r.company,
    }
  })
}
