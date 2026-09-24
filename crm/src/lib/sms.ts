/**
 * Texting customers about their orders, through Twilio.
 *
 * Every send goes through sendSms, which refuses before it spends money on
 * anything it should not send: no credentials, no number, a number we cannot
 * put in E.164, or a customer who told us to stop. Nothing here throws at the
 * caller. An order must never fail to save because a text could not go out,
 * so a failure is logged and reported in the return value.
 *
 * Environment:
 *   TWILIO_ACCOUNT_SID    starts AC…
 *   TWILIO_AUTH_TOKEN     the account's auth token
 *   TWILIO_FROM_NUMBER    the sending number in E.164, e.g. +15512457492
 *   TWILIO_MESSAGING_SERVICE_SID  optional; used instead of the from number
 *                         when set, which is what an A2P 10DLC campaign gives
 *                         you and the better thing to send from.
 *
 * Before real customers get any of this, the number has to be registered for
 * A2P 10DLC in the Twilio console. US carriers filter unregistered
 * application traffic to mobile numbers, so an unregistered send can be
 * accepted by Twilio and still never arrive.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.twilio.com/2010-04-01'
const FETCH_TIMEOUT_MS = 15_000

/** One SMS segment is 160 GSM-7 characters; keep a message inside two. */
export const MAX_SMS_CHARS = 300

export interface TwilioConfig {
  accountSid: string
  authToken: string
  from: string | null
  messagingServiceSid: string | null
}

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!accountSid || !authToken) return null
  const from = process.env.TWILIO_FROM_NUMBER?.trim() || null
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null
  if (!from && !messagingServiceSid) return null
  return { accountSid, authToken, from, messagingServiceSid }
}

/**
 * A US number in E.164, or null when it is not one we can dial.
 *
 * Deliberately conservative: ten digits, or eleven starting with 1, or an
 * already-E.164 string. Anything else (an extension, an international number
 * we have no rules for, a typo) returns null rather than a guess, because a
 * guessed number texts a stranger about someone else's gift.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export type SmsOutcome =
  | { sent: true; sid: string }
  | { sent: false; reason: 'not_configured' | 'no_consent' | 'no_number' | 'opted_out' | 'failed' | 'empty' }

/** Has this number, or the contact behind it, asked us to stop? */
export async function isOptedOut(
  supabase: SupabaseClient,
  orgId: string,
  phone: string,
  contactId?: string | null
): Promise<boolean> {
  const { data: refusal } = await supabase
    .from('sms_opt_outs')
    .select('id')
    .eq('organization_id', orgId)
    .eq('phone', phone)
    .maybeSingle()
  if (refusal?.id) return true

  if (contactId) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('sms_opt_out')
      .eq('id', contactId)
      .maybeSingle()
    if (contact?.sms_opt_out) return true
  }
  return false
}

export interface SendSmsInput {
  orgId: string
  to: string | null | undefined
  body: string
  /** Attached to the activity, so the text sits on the customer's timeline. */
  contactId?: string | null
  dealId?: string | null
  /** What this text was about, for the activity title and the metadata. */
  kind: 'order_confirmed' | 'order_shipped' | 'order_delivered' | 'manual'
  /** Whether the buyer ticked "Text me order updates" at checkout
   *  (orders.sms_consent). Required, so no caller can forget to ask. A
   *  phone number from PayPal or Stripe is not permission to text it. */
  consent: boolean
  /** Extra context for the activity metadata: the order number, say. */
  metadata?: Record<string, unknown>
}

/**
 * Sends one message and records it as an activity.
 *
 * The activity is written whatever the outcome, including a refusal, because
 * "we did not text this customer, and why" is exactly what someone looking at
 * the timeline needs to know.
 */
export async function sendSms(
  supabase: SupabaseClient,
  input: SendSmsInput
): Promise<SmsOutcome> {
  const body = input.body.trim().slice(0, MAX_SMS_CHARS)
  if (!body) return { sent: false, reason: 'empty' }

  if (input.consent !== true) {
    await logSms(supabase, input, toE164(input.to), { sent: false, reason: 'no_consent' }, body)
    return { sent: false, reason: 'no_consent' }
  }

  const to = toE164(input.to)
  if (!to) {
    await logSms(supabase, input, null, { sent: false, reason: 'no_number' }, body)
    return { sent: false, reason: 'no_number' }
  }

  const config = getTwilioConfig()
  if (!config) {
    console.warn('[sms] Twilio is not configured; no message sent')
    await logSms(supabase, input, to, { sent: false, reason: 'not_configured' }, body)
    return { sent: false, reason: 'not_configured' }
  }

  if (await isOptedOut(supabase, input.orgId, to, input.contactId)) {
    await logSms(supabase, input, to, { sent: false, reason: 'opted_out' }, body)
    return { sent: false, reason: 'opted_out' }
  }

  const params = new URLSearchParams({ To: to, Body: body })
  if (config.messagingServiceSid) params.set('MessagingServiceSid', config.messagingServiceSid)
  else if (config.from) params.set('From', config.from)

  let outcome: SmsOutcome
  try {
    const res = await fetch(`${API}/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as { sid?: unknown; message?: unknown } | null
    if (!res.ok) {
      console.error('[sms] Twilio refused the message:', res.status, typeof json?.message === 'string' ? json.message : '')
      outcome = { sent: false, reason: 'failed' }
    } else if (typeof json?.sid === 'string') {
      outcome = { sent: true, sid: json.sid }
    } else {
      outcome = { sent: false, reason: 'failed' }
    }
  } catch (err) {
    console.error('[sms] Twilio error:', err instanceof Error ? err.message : err)
    outcome = { sent: false, reason: 'failed' }
  }

  await logSms(supabase, input, to, outcome, body)
  return outcome
}

const OUTCOME_LABEL: Record<Exclude<SmsOutcome, { sent: true; sid: string }>['reason'], string> = {
  not_configured: 'not sent: texting is not set up yet',
  no_consent: 'not sent: the customer did not agree to order texts at checkout',
  no_number: 'not sent: no usable mobile number',
  opted_out: 'not sent: this customer asked us to stop texting',
  failed: 'not sent: the carrier or Twilio refused it',
  empty: 'not sent: the message was empty',
}

async function logSms(
  supabase: SupabaseClient,
  input: SendSmsInput,
  to: string | null,
  outcome: SmsOutcome,
  body: string
): Promise<void> {
  const title = outcome.sent
    ? `Text to ${to}`
    : `Text to ${to ?? 'this customer'} ${OUTCOME_LABEL[outcome.reason]}`
  const { error } = await supabase.from('activities').insert({
    organization_id: input.orgId,
    contact_id: input.contactId ?? null,
    deal_id: input.dealId ?? null,
    type: 'sms',
    title: title.slice(0, 200),
    description: body,
    status: 'completed',
    completed_at: new Date().toISOString(),
    metadata: {
      to,
      kind: input.kind,
      sent: outcome.sent,
      ...(outcome.sent ? { sid: outcome.sid } : { reason: outcome.reason }),
      ...(input.metadata ?? {}),
    },
  })
  if (error) console.error('[sms] could not record the message:', error.message)
}

// ─────────────────────────────────────────────
// What we actually say
// ─────────────────────────────────────────────

/** How we sign a text to a customer. The CRM's configured name is
 *  'OccasionsBox', which is right for a filename and wrong in a sentence. */
export const SMS_BRAND = 'Occasions Box'

export interface OrderTextContext {
  orderNumber: string
  firstName?: string | null
  carrier?: string | null
  trackingNumber?: string | null
  /** How we name ourselves in the message. Defaults to SMS_BRAND. */
  brand?: string
}

const hello = (name?: string | null) => (name ? `Hi ${name}, ` : 'Hi, ')

/** The first message a customer gets carries the opt-out, because it is the
 *  one that has to. Later ones stay short. */
export function orderConfirmedText(c: OrderTextContext): string {
  const brand = c.brand ?? SMS_BRAND
  return (
    `${hello(c.firstName)}it is ${brand}. We have your order ${c.orderNumber} and we are packing it by hand. ` +
    `We will text you the tracking as soon as it ships. Reply STOP to stop texts.`
  )
}

export function orderShippedText(c: OrderTextContext): string {
  const brand = c.brand ?? SMS_BRAND
  const how = [c.carrier, c.trackingNumber].filter(Boolean).join(' ')
  return (
    `${hello(c.firstName)}your ${brand} order ${c.orderNumber} is on its way` +
    (how ? `: ${how}.` : '.') +
    ` Reply STOP to stop texts.`
  )
}

export function orderDeliveredText(c: OrderTextContext): string {
  const brand = c.brand ?? SMS_BRAND
  return (
    `${hello(c.firstName)}your ${brand} order ${c.orderNumber} shows as delivered. ` +
    `We hope it lands beautifully. Reply STOP to stop texts.`
  )
}

// ─────────────────────────────────────────────
// Inbound: proving a request really came from Twilio
// ─────────────────────────────────────────────

/**
 * Twilio signs an inbound webhook with HMAC-SHA1 over the full URL followed
 * by every POST parameter, sorted by name and concatenated as name+value,
 * keyed by the account auth token. Anyone can POST to a public URL, so
 * without this check a stranger could opt our customers out, or opt a
 * customer back in who asked us to stop.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string
): boolean {
  if (!signature) return false
  let payload = url
  for (const key of Object.keys(params).sort()) payload += key + params[key]
  const expected = createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest()
  let given: Buffer
  try {
    given = Buffer.from(signature, 'base64')
  } catch {
    return false
  }
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The words carriers require us to treat as opt-out and opt-in. */
export const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']
export const START_WORDS = ['start', 'yes', 'unstop']
export const HELP_WORDS = ['help', 'info']
