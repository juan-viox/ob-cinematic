/**
 * Stripe Checkout for the shop, server side.
 *
 * The marketing site is static, so it cannot hold the secret key. It posts
 * the cart to /api/v1/checkout/stripe, which prices every line from the
 * catalogue, creates a hosted Checkout Session and sends the buyer to it.
 * Stripe then calls /api/v1/webhooks/stripe once the session is paid, and
 * that webhook, checked against its signature, is the only thing that
 * records a Stripe order. The browser is never trusted with "paid".
 *
 * No SDK: the API is form-encoded HTTP and this needs three calls, so a
 * small encoder over fetch keeps the dependency list where it is.
 *
 * STRIPE_SECRET_KEY  the live (sk_live_) or test (sk_test_) secret key.
 * STRIPE_WEBHOOK_SECRET  the signing secret (whsec_) of the endpoint that
 *   points at /api/v1/webhooks/stripe. Without it every webhook is refused
 *   with a 503 and no Stripe order is ever recorded.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.stripe.com/v1'
const FETCH_TIMEOUT_MS = 15_000

export interface StripeConfig {
  secretKey: string
  webhookSecret: string | null
}

/** null when Stripe is not configured. */
export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) return null
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null
  return { secretKey, webhookSecret }
}

/** Stripe reads nested params as a[b][0][c]=v. */
function encodeInto(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((v, i) => encodeInto(params, `${key}[${i}]`, v))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) encodeInto(params, `${key}[${k}]`, v)
    return
  }
  params.append(key, String(value))
}

export function encodeForm(body: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) encodeInto(params, k, v)
  return params.toString()
}

export type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

export async function stripeRequest<T = Record<string, unknown>>(
  config: StripeConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<StripeResult<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
    Accept: 'application/json',
  }
  let url = `${API}${path}`
  let payload: string | undefined
  if (body) {
    const encoded = encodeForm(body)
    if (method === 'GET') url += (url.includes('?') ? '&' : '?') + encoded
    else {
      payload = encoded
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    console.error(`[stripe] ${method} ${path} error:`, err instanceof Error ? err.message : err)
    return { ok: false, status: 502, error: 'Unable to reach Stripe' }
  }

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    const message = (json as { error?: { message?: unknown } } | null)?.error?.message
    console.error(`[stripe] ${method} ${path} failed:`, res.status, typeof message === 'string' ? message : '')
    return { ok: false, status: 502, error: 'Stripe could not complete the request' }
  }
  return { ok: true, data: json as T }
}

// ─────────────────────────────────────────────
// Checkout Sessions
// ─────────────────────────────────────────────

export interface StripeAddress {
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
  country?: string | null
}

export interface StripeShipping {
  name?: string | null
  address?: StripeAddress | null
}

export interface StripeCustomField {
  key: string
  text?: { value?: string | null } | null
  dropdown?: { value?: string | null } | null
  numeric?: { value?: string | null } | null
}

export interface StripeCheckoutSession {
  id: string
  url?: string | null
  status?: 'open' | 'complete' | 'expired' | null
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  amount_subtotal?: number | null
  amount_total?: number | null
  currency?: string | null
  payment_intent?: string | { id: string } | null
  customer_details?: {
    email?: string | null
    name?: string | null
    phone?: string | null
    address?: StripeAddress | null
  } | null
  /** Where the session says it ships. Older API versions put it at the top
   *  level, newer ones under collected_information; read both. */
  shipping_details?: StripeShipping | null
  collected_information?: { shipping_details?: StripeShipping | null } | null
  custom_fields?: StripeCustomField[] | null
  metadata?: Record<string, string> | null
}

export interface StripeLineItem {
  id: string
  description?: string | null
  quantity?: number | null
  amount_total?: number | null
  price?: {
    unit_amount?: number | null
    product?: string | { id: string; name?: string | null; metadata?: Record<string, string> | null } | null
  } | null
}

export function createCheckoutSession(
  config: StripeConfig,
  params: Record<string, unknown>
): Promise<StripeResult<StripeCheckoutSession>> {
  return stripeRequest<StripeCheckoutSession>(config, 'POST', '/checkout/sessions', params)
}

export function fetchCheckoutSession(
  config: StripeConfig,
  sessionId: string
): Promise<StripeResult<StripeCheckoutSession>> {
  return stripeRequest<StripeCheckoutSession>(config, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`)
}

/** All of a session's line items with the product expanded, because the
 *  cart's card and message ride in each product's metadata. */
export async function fetchCheckoutLineItems(
  config: StripeConfig,
  sessionId: string
): Promise<StripeResult<StripeLineItem[]>> {
  const result = await stripeRequest<{ data?: StripeLineItem[] }>(
    config,
    'GET',
    `/checkout/sessions/${encodeURIComponent(sessionId)}/line_items`,
    { limit: 100, expand: ['data.price.product'] }
  )
  if (!result.ok) return result
  return { ok: true, data: Array.isArray(result.data.data) ? result.data.data : [] }
}

/** The payment intent id is the reference the Stripe dashboard searches by. */
export function paymentIntentId(session: StripeCheckoutSession): string | null {
  const pi = session.payment_intent
  if (typeof pi === 'string' && pi) return pi
  if (pi && typeof pi === 'object' && typeof pi.id === 'string' && pi.id) return pi.id
  return null
}

export function shippingOf(session: StripeCheckoutSession): StripeShipping | null {
  return session.collected_information?.shipping_details ?? session.shipping_details ?? null
}

export function customFieldValue(session: StripeCheckoutSession, key: string): string | null {
  const field = (session.custom_fields ?? []).find((f) => f.key === key)
  const value = field?.text?.value ?? field?.dropdown?.value ?? field?.numeric?.value ?? null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// ─────────────────────────────────────────────
// Webhook signatures
// ─────────────────────────────────────────────

/**
 * Stripe-Signature is "t=<unix>,v1=<hex>[,v1=<hex>]". The signed payload is
 * "<t>.<raw body>" under the endpoint's signing secret. Five minutes of
 * tolerance, the same as Stripe's own libraries.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300
): boolean {
  if (!header) return false
  let timestamp = ''
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 't') timestamp = v
    else if (k === 'v1' && v) signatures.push(v)
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (age > toleranceSeconds) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest()
  return signatures.some((sig) => {
    if (!/^[0-9a-f]+$/i.test(sig)) return false
    const given = Buffer.from(sig, 'hex')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
