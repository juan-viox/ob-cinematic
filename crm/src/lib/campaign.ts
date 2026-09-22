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
  /** Per-contact custom field values, keyed by field_name. */
  custom?: Record<string, string> | null
}

/**
 * Placeholder keys are matched loosely on purpose.
 *
 * People write {{First Name}} and {{Company Name}} because that is how every
 * other mail-merge tool spells them. Insisting on {{first_name}} would mean a
 * draft that looks right, sends, and arrives with the placeholder still in it.
 * So case, spaces, hyphens and surrounding whitespace are all normalised away
 * before lookup.
 */
function normaliseKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** Spellings of the same field that people reasonably reach for. */
const ALIASES: Record<string, string> = {
  company_name: 'company',
  companyname: 'company',
  firstname: 'first_name',
  lastname: 'last_name',
  title: 'job_title',
  jobtitle: 'job_title',
  personalized_opening: 'personalized_opening',
  personalised_opening: 'personalized_opening',
  relevant_gifting_use_case: 'gifting_use_case',
  gifting_use_case: 'gifting_use_case',
  use_case: 'gifting_use_case',
}

export function mergeValues(contact: MergeContact): Record<string, string> {
  const first = (contact.first_name ?? '').trim()
  const last = (contact.last_name ?? '').trim()
  const values: Record<string, string> = {
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(' '),
    email: (contact.email ?? '').trim(),
    job_title: (contact.job_title ?? '').trim(),
    company: (contact.company?.name ?? '').trim(),
  }
  // Custom fields last so a per-contact value always wins.
  for (const [k, v] of Object.entries(contact.custom ?? {})) {
    values[normaliseKey(k)] = (v ?? '').trim()
  }
  return values
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
  const values = mergeValues(contact)
  return template.replace(/\{\{([^{}]+)\}\}/g, (whole, rawKey: string) => {
    const key = normaliseKey(rawKey)
    const resolved = ALIASES[key] ?? key
    return resolved in values ? values[resolved] : whole
  })
}

/**
 * The placeholders a body uses that we cannot fill for a given contact.
 *
 * Two different disasters, one check. A placeholder with no field behind it
 * goes out as the literal characters "{{Personalized Opening}}", because
 * renderMerge leaves what it cannot resolve visible: right on a draft screen,
 * indefensible in a stranger's inbox. A placeholder whose field exists but is
 * empty is quieter and no better, and arrives as "Hi ,".
 *
 * The campaign screen calls this on the contact being previewed. The send
 * route calls it over the whole audience, which is the one that counts: a
 * hand-checked list of twenty-four never trips this, and a bought list of a
 * hundred and fifty always does.
 */
export function missingMergeFields(template: string, contact: MergeContact): string[] {
  const values = mergeValues(contact)
  const missing = new Set<string>()
  for (const m of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const raw = m[1].trim()
    const key = normaliseKey(raw)
    const resolved = ALIASES[key] ?? key
    if (!(resolved in values) || values[resolved] === '') missing.add(raw)
  }
  return [...missing].sort()
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

/**
 * Where a reply actually goes.
 *
 * The campaign sends from a subdomain that exists only to send. Nobody has a
 * mailbox there, so a prospect who hits Reply would bounce, and the whole
 * point of the campaign is the replies. Reply-To points at a real, watched
 * address on the main domain instead.
 *
 * Falls back to the transactional sender, which is always a real mailbox.
 * Unlike the From address this has no reason to be strict: any real inbox
 * beats a guaranteed bounce.
 */
export function campaignReplyTo(): string | null {
  return (
    process.env.RESEND_CAMPAIGN_REPLY_TO?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    null
  )
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
  /** Custom field values keyed by field_name, for the per-contact placeholders. */
  custom: Record<string, string>
}

/** Why a contact on the list is not getting this message. */
export function skipReason(c: CampaignRecipient): SkipReason | null {
  if (c.email_opt_out) return 'opted_out'
  if (!c.email || !c.email.includes('@')) return 'no_email'
  return null
}

/**
 * The tag that marks a seed address: our own inboxes, on the list so a
 * campaign can be proved before it reaches a real prospect.
 */
export const TEST_TAG = 'Internal Test'

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
  return loadContacts(supabase, orgId, ids)
}

/**
 * Our own inboxes, org-wide, whatever tag is being sent to.
 *
 * Deliberately not intersected with the campaign's tag. A seed is a place to
 * deliver a proof copy, not a member of the audience, and requiring it to be
 * on the list meant a tag of pure prospects could never be tested at all:
 * the test button had nobody to write to, so the lock it guards never opened.
 */
export async function seedRecipients(
  supabase: SupabaseClient,
  orgId: string
): Promise<CampaignRecipient[]> {
  const { data: tag } = await supabase
    .from('tags')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', TEST_TAG)
    .maybeSingle()
  if (!tag?.id) return []

  const { data: links } = await supabase
    .from('entity_tags')
    .select('entity_id')
    .eq('tag_id', tag.id)
    .eq('entity_type', 'contact')

  const ids = (links ?? []).map((l) => l.entity_id as string)
  if (!ids.length) return []
  return loadContacts(supabase, orgId, ids)
}

/** Contacts by id, with what a merge and an opt-out check both need. */
async function loadContacts(
  supabase: SupabaseClient,
  orgId: string,
  ids: string[]
): Promise<CampaignRecipient[]> {
  // Scoped to the org as well as the ids: entity_tags carries no
  // organization_id of its own, so the contacts read is what enforces it.
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, first_name, last_name, job_title, email_opt_out, unsubscribe_token, company:companies(name)')
    .eq('organization_id', orgId)
    .in('id', ids)
    .order('first_name')
  if (error) throw new Error(error.message)

  const contacts = (data ?? []).map((row) => {
    const r = row as unknown as Omit<CampaignRecipient, 'company' | 'custom'> & {
      company: { name: string | null } | { name: string | null }[] | null
    }
    return {
      ...r,
      company: Array.isArray(r.company) ? (r.company[0] ?? null) : r.company,
      custom: {} as Record<string, string>,
    }
  })

  // Per-contact placeholders (the personalised opening, the use case) live in
  // custom fields. Fetched in one query for the whole audience rather than one
  // per recipient, which on a list of two hundred is the difference between a
  // send that finishes and a function that times out.
  if (contacts.length) {
    const { data: values } = await supabase
      .from('custom_field_values')
      .select('entity_id, value, field:custom_field_definitions!inner(field_name, organization_id, entity_type)')
      .eq('entity_type', 'contact')
      .in('entity_id', contacts.map((c) => c.id))
    const byId = new Map(contacts.map((c) => [c.id, c]))
    for (const row of (values ?? []) as unknown as Array<{
      entity_id: string
      value: string | null
      field: { field_name: string; organization_id: string; entity_type: string } | Array<{ field_name: string; organization_id: string; entity_type: string }>
    }>) {
      const def = Array.isArray(row.field) ? row.field[0] : row.field
      if (!def || def.organization_id !== orgId || def.entity_type !== 'contact') continue
      const c = byId.get(row.entity_id)
      if (c) c.custom[def.field_name] = row.value ?? ''
    }
  }

  return contacts
}
