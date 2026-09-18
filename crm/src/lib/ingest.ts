import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crmConfig from '@/crm.config'

/**
 * Shared helpers for the public ingest API (src/app/api/v1/ingest/**).
 *
 * Auth model: a request is accepted when it carries `x-api-key` matching
 * SITE_API_KEY (server-to-server callers), OR when it is a browser request
 * whose Origin (fallback: Referer) hostname is in the allowlist.
 *
 * Every route resolves the organization by slug from crm.config and scopes
 * every read/write to that organization_id. Never "first org".
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type IngestAuth =
  | { ok: true; via: 'api_key' | 'origin' }
  | { ok: false; status: number; error: string }

export type JsonBody = Record<string, unknown>

export type ContactSource =
  | 'manual'
  | 'web_form'
  | 'newsletter'
  | 'voice_agent'
  | 'booking'
  | 'referral'
  | 'import'

export type ActivityType =
  | 'call'
  | 'email'
  | 'meeting'
  | 'task'
  | 'note'
  | 'voice_agent'
  | 'form_submission'

export type ActivityStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface UpsertContactInput {
  orgId: string
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  source: ContactSource
  /** Only written when the contact is created (never overwrites existing notes). */
  notes?: string | null
  companyId?: string | null
  jobTitle?: string | null
  /**
   * true only for api-key (server-to-server) callers: the existing contact's
   * fields may be overwritten. Origin-authenticated browser traffic (the
   * Origin header is spoofable) only fills fields that are currently blank
   * and never changes the phone or email of an existing contact.
   */
  trusted?: boolean
}

export interface UpsertContactResult {
  id: string
  created: boolean
}

export interface ActivityInput {
  orgId: string
  contactId: string | null
  dealId?: string | null
  type: ActivityType
  title: string
  description?: string | null
  status?: ActivityStatus
  dueDate?: string | null
  completedAt?: string | null
  metadata?: Record<string, unknown>
}

/** Thrown by helpers to short-circuit a route with a specific HTTP status. */
export class IngestError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'IngestError'
    this.status = status
  }
}

// ─────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────

export const LIMITS = {
  name: 100,
  email: 254,
  phone: 40,
  company: 150,
  title: 200,
  message: 5000,
  transcript: 20000,
  bodyBytes: 64 * 1024,
} as const

// ─────────────────────────────────────────────
// Origin allowlist + auth
// ─────────────────────────────────────────────

const DEFAULT_ALLOWED_HOSTS = [
  'occasionsbox.com',
  'www.occasionsbox.com',
  'ob-cinematic.vercel.app',
  'ob-cinematic-vio-x-bergsify.vercel.app',
  'ob-crm-vio-x-bergsify.vercel.app',
  'localhost',
]

function allowedHosts(): string[] {
  const raw = process.env.ALLOWED_ORIGINS
  if (!raw) return DEFAULT_ALLOWED_HOSTS
  const hosts = raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .map((h) => {
      // Tolerate full origins ("https://foo.com") in the env var.
      try {
        return h.includes('://') ? new URL(h).hostname : h
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  return hosts.length > 0 ? hosts : DEFAULT_ALLOWED_HOSTS
}

/** True when the hostname is allowed to call the ingest API from a browser. */
export function isAllowedHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false
  const host = hostname.toLowerCase()
  if (allowedHosts().includes(host)) return true
  // Vercel preview deployments of the marketing site.
  if (host.startsWith('ob-cinematic-') && host.endsWith('.vercel.app')) return true
  return false
}

/** Parses an Origin/Referer-style header into an origin string + hostname. */
function parseOrigin(value: string | null): { origin: string; host: string } | null {
  if (!value || value === 'null') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return { origin: url.origin, host: url.hostname }
  } catch {
    return null
  }
}

/** The request's browser origin (Origin header, falling back to Referer). */
export function requestOrigin(request: Request): { origin: string; host: string } | null {
  return parseOrigin(request.headers.get('origin')) ?? parseOrigin(request.headers.get('referer'))
}

/** Constant-time-ish string comparison to avoid trivial timing leaks on the key. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function authorizeIngest(request: Request): IngestAuth {
  const configuredKey = process.env.SITE_API_KEY
  const providedKey = request.headers.get('x-api-key')

  if (providedKey) {
    if (configuredKey && safeEqual(providedKey, configuredKey)) {
      return { ok: true, via: 'api_key' }
    }
    return { ok: false, status: 401, error: 'Invalid API key' }
  }

  const origin = requestOrigin(request)
  if (origin && isAllowedHost(origin.host)) {
    return { ok: true, via: 'origin' }
  }

  return { ok: false, status: 401, error: 'Unauthorized' }
}

// ─────────────────────────────────────────────
// CORS + JSON responses
// ─────────────────────────────────────────────

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Max-Age': '86400',
  }
  const origin = parseOrigin(request.headers.get('origin'))
  if (origin && isAllowedHost(origin.host)) {
    headers['Access-Control-Allow-Origin'] = origin.origin
  }
  return headers
}

/** Standard OPTIONS (preflight) handler for every ingest route. */
export function handleOptions(request: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

export function jsonOk(request: Request, body: JsonBody, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(request) })
}

export function jsonError(request: Request, error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status, headers: corsHeaders(request) })
}

/**
 * Maps any thrown value to a JSON error response. IngestError keeps its
 * status/message; anything else becomes a generic 500 (never leaks err.message).
 */
export function errorResponse(request: Request, err: unknown, route: string): NextResponse {
  if (err instanceof IngestError) {
    return jsonError(request, err.message, err.status)
  }
  console.error(`[ingest:${route}]`, err instanceof Error ? err.message : err)
  return jsonError(request, 'Internal server error', 500)
}

// ─────────────────────────────────────────────
// Body parsing + sanitizers
// ─────────────────────────────────────────────

/** Reads and validates a JSON object body. Throws IngestError on bad input. */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > LIMITS.bodyBytes) {
    throw new IngestError('Request body too large', 413)
  }
  let text: string
  try {
    text = await request.text()
  } catch {
    throw new IngestError('Unable to read request body', 400)
  }
  if (text.length > LIMITS.bodyBytes) {
    throw new IngestError('Request body too large', 413)
  }
  if (!text.trim()) {
    throw new IngestError('Request body is required', 400)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new IngestError('Invalid JSON body', 400)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new IngestError('Body must be a JSON object', 400)
  }
  return parsed as JsonBody
}

/** Honeypot: a filled `website` field means a bot. Callers respond 200 silently. */
export function isSpam(body: JsonBody): boolean {
  const honeypot = body.website
  return typeof honeypot === 'string' && honeypot.trim().length > 0
}

/** Trims and caps a string; returns null for non-strings or empty strings. */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/** Parses a finite number from a number or numeric string; null otherwise. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Normalized (lowercased) email or null when missing/invalid. */
export function email(v: unknown): string | null {
  const s = str(v, LIMITS.email)
  if (!s) return null
  const lower = s.toLowerCase()
  return EMAIL_RE.test(lower) ? lower : null
}

/** Loosely validated phone: keeps digits and common punctuation. */
export function phone(v: unknown): string | null {
  const s = str(v, LIMITS.phone)
  if (!s) return null
  const cleaned = s.replace(/[^\d+()\-.\s]/g, '').trim()
  const digits = cleaned.replace(/\D/g, '')
  return digits.length >= 7 ? cleaned : null
}

/** ISO-8601 date/datetime string or null when unparseable. */
export function isoDate(v: unknown): string | null {
  const s = str(v, 64)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Splits a full name into first/last. */
export function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null }
  const parts = fullName.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: null, lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null }
}

export function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(' ').trim()
}

// ─────────────────────────────────────────────
// Supabase (service role) + organization
// ─────────────────────────────────────────────

/**
 * Service-role client for ingest routes. Throws a 503 IngestError when the
 * deployment has not been configured yet (env vars missing), so the route
 * returns a clean JSON error instead of crashing.
 */
export function getIngestClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new IngestError('CRM is not configured yet', 503)
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/**
 * Resolves organizations.id for crmConfig.slug, creating the organization
 * (and seeding default deal stages from crm.config) when it does not exist.
 */
export async function getOrgId(supabase: SupabaseClient): Promise<string> {
  const { data: existing, error: selectError } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', crmConfig.slug)
    .maybeSingle()

  if (selectError) throw new IngestError('Unable to resolve organization', 500)
  if (existing?.id) return existing.id as string

  const { data: created, error: insertError } = await supabase
    .from('organizations')
    .insert({ name: crmConfig.name, slug: crmConfig.slug })
    .select('id')
    .single()

  if (insertError || !created) {
    // Lost a race with a concurrent creator: re-read by slug.
    const { data: again } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', crmConfig.slug)
      .maybeSingle()
    if (again?.id) return again.id as string
    throw new IngestError('Unable to create organization', 500)
  }

  const orgId = created.id as string
  await seedDealStagesIfEmpty(supabase, orgId)
  return orgId
}

async function seedDealStagesIfEmpty(supabase: SupabaseClient, orgId: string): Promise<void> {
  const { data: existingStages } = await supabase
    .from('deal_stages')
    .select('id')
    .eq('organization_id', orgId)
    .limit(1)

  if (existingStages && existingStages.length > 0) return

  const rows = crmConfig.settings.defaultDealStages.map((s) => ({
    organization_id: orgId,
    name: s.name,
    color: s.color,
    sort_order: s.sort_order,
    is_won: s.is_won ?? false,
    is_lost: s.is_lost ?? false,
  }))
  const { error } = await supabase.from('deal_stages').insert(rows)
  if (error) console.error('[ingest] failed to seed deal stages:', error.message)
}

/** First pipeline stage (lowest sort_order) for the org, or null when none. */
export async function getFirstStageId(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from('deal_stages')
    .select('id')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/** Stage by (case-insensitive) name, falling back to the first stage. */
export async function getStageIdByName(
  supabase: SupabaseClient,
  orgId: string,
  name: string
): Promise<string | null> {
  const { data } = await supabase
    .from('deal_stages')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', name)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (data?.id) return data.id as string
  return getFirstStageId(supabase, orgId)
}

// ─────────────────────────────────────────────
// Contacts / companies / activities
// ─────────────────────────────────────────────

interface ExistingContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  company_id: string | null
  job_title: string | null
}

const EXISTING_CONTACT_COLUMNS = 'id, first_name, last_name, email, phone, company_id, job_title'

function isBlank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === ''
}

/**
 * Finds a contact by email (preferred) or phone within the org and updates
 * it; otherwise inserts a new contact.
 *
 * Trusted (api-key) callers overwrite name/phone/email/company/title with
 * whatever they send. Untrusted (origin) callers can only fill blank fields
 * and never touch phone/email of an existing contact — otherwise anyone who
 * knows a client's email could rewrite that client's record with one POST.
 */
export async function upsertContact(
  supabase: SupabaseClient,
  input: UpsertContactInput
): Promise<UpsertContactResult> {
  const { orgId } = input
  const emailValue = input.email ?? null
  const phoneValue = input.phone ?? null
  const trusted = input.trusted === true

  let existing: ExistingContactRow | null = null

  if (emailValue) {
    const { data } = await supabase
      .from('contacts')
      .select(EXISTING_CONTACT_COLUMNS)
      .eq('organization_id', orgId)
      .eq('email', emailValue)
      .maybeSingle()
    existing = (data as ExistingContactRow | null) ?? null
  }

  if (!existing && phoneValue) {
    const { data } = await supabase
      .from('contacts')
      .select(EXISTING_CONTACT_COLUMNS)
      .eq('organization_id', orgId)
      .eq('phone', phoneValue)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    existing = (data as ExistingContactRow | null) ?? null
  }

  if (existing) {
    const existingId = existing.id
    const update: Record<string, string> = {}
    if (trusted) {
      if (input.firstName) update.first_name = input.firstName
      if (input.lastName) update.last_name = input.lastName
      if (phoneValue) update.phone = phoneValue
      if (emailValue) update.email = emailValue
      if (input.companyId) update.company_id = input.companyId
      if (input.jobTitle) update.job_title = input.jobTitle
    } else {
      // Fill-blanks only. Phone and email are never changed from origin traffic.
      if (input.firstName && isBlank(existing.first_name)) update.first_name = input.firstName
      if (input.lastName && isBlank(existing.last_name)) update.last_name = input.lastName
      if (input.companyId && isBlank(existing.company_id)) update.company_id = input.companyId
      if (input.jobTitle && isBlank(existing.job_title)) update.job_title = input.jobTitle
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('contacts')
        .update(update)
        .eq('id', existingId)
        .eq('organization_id', orgId)
      if (error) console.error('[ingest] contact update failed:', error.message)
    }
    return { id: existingId, created: false }
  }

  const insertRow = {
    organization_id: orgId,
    first_name: input.firstName || (emailValue ? emailValue.split('@')[0] : 'Unknown'),
    last_name: input.lastName ?? '',
    email: emailValue,
    phone: phoneValue,
    source: input.source,
    notes: input.notes ?? null,
    company_id: input.companyId ?? null,
    job_title: input.jobTitle ?? null,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('contacts')
    .insert(insertRow)
    .select('id')
    .single()

  if (insertError || !inserted) {
    // UNIQUE(organization_id, email) race: another request created it first.
    if (emailValue) {
      const { data: raced } = await supabase
        .from('contacts')
        .select('id')
        .eq('organization_id', orgId)
        .eq('email', emailValue)
        .maybeSingle()
      if (raced?.id) return { id: raced.id as string, created: false }
    }
    console.error('[ingest] contact insert failed:', insertError?.message)
    throw new IngestError('Unable to save contact', 500)
  }

  return { id: inserted.id as string, created: true }
}

/** Finds (case-insensitive) or creates a company by name within the org. */
export async function findOrCreateCompany(
  supabase: SupabaseClient,
  orgId: string,
  name: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('name', escapeLike(name))
    .limit(1)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('companies')
    .insert({ organization_id: orgId, name })
    .select('id')
    .single()
  if (error || !created) {
    console.error('[ingest] company insert failed:', error?.message)
    return null
  }
  return created.id as string
}

export async function createActivity(supabase: SupabaseClient, input: ActivityInput): Promise<string | null> {
  const { data, error } = await supabase
    .from('activities')
    .insert({
      organization_id: input.orgId,
      contact_id: input.contactId,
      deal_id: input.dealId ?? null,
      type: input.type,
      title: input.title.slice(0, LIMITS.title),
      description: input.description ?? null,
      status: input.status ?? 'completed',
      due_date: input.dueDate ?? null,
      completed_at: input.completedAt ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[ingest] activity insert failed:', error?.message)
    return null
  }
  return data.id as string
}

/** Finds (scoped to org) or creates a tag by exact name. */
export async function ensureTag(
  supabase: SupabaseClient,
  orgId: string,
  name: string,
  color: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('tags')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', name)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const { data: created, error } = await supabase
    .from('tags')
    .insert({ organization_id: orgId, name, color })
    .select('id')
    .single()
  if (created?.id) return created.id as string

  // UNIQUE(organization_id, name) race.
  const { data: raced } = await supabase
    .from('tags')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', name)
    .maybeSingle()
  if (raced?.id) return raced.id as string
  console.error('[ingest] tag insert failed:', error?.message)
  return null
}

export async function tagEntity(
  supabase: SupabaseClient,
  tagId: string,
  entityType: 'contact' | 'company' | 'deal',
  entityId: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('entity_tags')
    .select('id')
    .eq('tag_id', tagId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle()
  if (existing) return
  const { error } = await supabase
    .from('entity_tags')
    .insert({ tag_id: tagId, entity_type: entityType, entity_id: entityId })
  // Duplicate (race) is fine; anything else is logged, not fatal.
  if (error && error.code !== '23505') console.error('[ingest] entity_tags insert failed:', error.message)
}

/** Escapes LIKE/ILIKE wildcards so user text is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}
