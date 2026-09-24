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

export type StripeResult<T> =
  | { ok: true; data: T }
  /** `status` is what we answer our own caller with; `httpStatus` is what
   *  Stripe actually said, which the health check needs to tell "the key is
   *  wrong" apart from "Stripe is having a bad morning". */
  | { ok: false; status: number; error: string; httpStatus?: number }

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
    return { ok: false, status: 502, error: 'Stripe could not complete the request', httpStatus: res.status }
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

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────

/**
 * Whether a card payment would actually become an order, asked before anyone
 * spends money finding out.
 *
 * Both keys being present is not the same as card checkout working, and the
 * gap between them is expensive. STRIPE_WEBHOOK_SECRET can be a perfectly
 * valid signing secret belonging to an endpoint that points somewhere else, or
 * to an endpoint that is disabled, or to one that never subscribed to the
 * event that records a sale. In all three cases the shop takes the money, the
 * buyer gets a receipt, and the CRM never hears about it. Nothing on the
 * server can notice: the webhook that would have told us is the thing that is
 * missing.
 *
 * So this reads the endpoint list out of Stripe and says which endpoints exist,
 * where they point, and what they listen for. The one thing it cannot confirm
 * is that the signing secret in the environment belongs to the endpoint it
 * found, because Stripe returns an endpoint's secret only at the moment it is
 * created. That last inch is what a real test payment proves.
 */

/** The path Stripe must call for a card sale to be recorded. */
export const WEBHOOK_PATH = '/api/v1/webhooks/stripe'

/** The event that means money arrived and an order should exist. */
export const CHECKOUT_EVENT = 'checkout.session.completed'

export interface StripeWebhookEndpoint {
  id: string
  url: string
  enabled: boolean
  events: string[]
  /** Does this endpoint point at this CRM's webhook route. */
  pointsHere: boolean
  /** Does it listen for the event that records an order. */
  listensForCheckout: boolean
}

export interface StripeProbe {
  configured: boolean
  webhookSecretSet: boolean
  /** Read from the key prefix alone. No network call, and it explains a lot. */
  mode: 'live' | 'test' | 'unknown'
  /** A restricted key (rk_) may be denied the endpoint list even though it works. */
  restricted: boolean
  keyOk: boolean | null
  accountName: string | null
  accountId: string | null
  endpoints: StripeWebhookEndpoint[]
  /** False when the endpoint list could not be read at all. */
  endpointsReadable: boolean
  /** Plain English, worst first. Empty means nothing is wrong. */
  problems: string[]
}

function keyMode(secretKey: string): 'live' | 'test' | 'unknown' {
  if (/^[sr]k_live_/.test(secretKey)) return 'live'
  if (/^[sr]k_test_/.test(secretKey)) return 'test'
  return 'unknown'
}

interface StripeAccount {
  id?: string | null
  business_profile?: { name?: string | null } | null
  settings?: { dashboard?: { display_name?: string | null } | null } | null
}

interface StripeEndpointRow {
  id?: string | null
  url?: string | null
  status?: string | null
  enabled_events?: string[] | null
}

/** True when a registered endpoint URL is this CRM's webhook route. */
function pointsAtUs(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith(WEBHOOK_PATH)
  } catch {
    return false
  }
}

function readEndpoints(rows: StripeEndpointRow[]): StripeWebhookEndpoint[] {
  const endpoints: StripeWebhookEndpoint[] = []
  for (const row of rows) {
    const url = typeof row.url === 'string' ? row.url : ''
    if (!url) continue
    const events = Array.isArray(row.enabled_events) ? row.enabled_events.filter((e) => typeof e === 'string') : []
    endpoints.push({
      id: typeof row.id === 'string' ? row.id : url,
      url,
      enabled: row.status !== 'disabled',
      events,
      pointsHere: pointsAtUs(url),
      // '*' is Stripe's "send me everything", which does include this one.
      listensForCheckout: events.includes(CHECKOUT_EVENT) || events.includes('*'),
    })
  }
  return endpoints
}

export async function probeStripe(): Promise<StripeProbe> {
  const config = getStripeConfig()
  if (!config) {
    return {
      configured: false,
      webhookSecretSet: false,
      mode: 'unknown',
      restricted: false,
      keyOk: null,
      accountName: null,
      accountId: null,
      endpoints: [],
      endpointsReadable: false,
      problems: ['STRIPE_SECRET_KEY is not set, so card checkout is switched off and the shop offers PayPal only.'],
    }
  }

  const mode = keyMode(config.secretKey)
  const restricted = config.secretKey.startsWith('rk_')
  const webhookSecretSet = Boolean(config.webhookSecret)

  // Collected separately so the finished list reads worst first rather than in
  // the order the checks happened to run.
  const keyProblems: string[] = []
  const endpointProblems: string[] = []
  const secretProblems: string[] = []

  if (mode === 'test') {
    keyProblems.push('This is a Stripe test key. Real cards are declined, so no customer can pay by card today.')
  } else if (mode === 'unknown') {
    keyProblems.push('STRIPE_SECRET_KEY does not look like a Stripe secret key. It should begin with sk_live_ or sk_test_.')
  }

  if (!webhookSecretSet) {
    secretProblems.push(
      'STRIPE_WEBHOOK_SECRET is not set. Card checkout refuses to start rather than take a payment it could not record, so the shop currently offers PayPal only.'
    )
  } else if (!config.webhookSecret?.startsWith('whsec_')) {
    secretProblems.push(
      'STRIPE_WEBHOOK_SECRET does not begin with whsec_, so it is probably not a signing secret. Every webhook would fail its signature check and no card sale would reach the CRM.'
    )
  }

  const account = await stripeRequest<StripeAccount>(config, 'GET', '/account')
  if (!account.ok) {
    const rejected = account.httpStatus === 401
    return {
      configured: true,
      webhookSecretSet,
      mode,
      restricted,
      keyOk: rejected ? false : null,
      accountName: null,
      accountId: null,
      endpoints: [],
      endpointsReadable: false,
      problems: [
        rejected
          ? 'Stripe rejected the secret key. Card checkout cannot work until it is replaced.'
          : 'Stripe could not be reached, so the key could not be checked. Try again in a moment.',
        ...keyProblems,
        ...secretProblems,
      ],
    }
  }

  const accountName =
    account.data.settings?.dashboard?.display_name ?? account.data.business_profile?.name ?? null
  const accountId = typeof account.data.id === 'string' ? account.data.id : null

  // Stripe scopes this list to the key's own mode, so a live key never sees
  // test endpoints and the absence of one here is the real absence.
  const list = await stripeRequest<{ data?: StripeEndpointRow[] }>(config, 'GET', '/webhook_endpoints', { limit: 100 })
  let endpoints: StripeWebhookEndpoint[] = []
  let endpointsReadable = true

  if (!list.ok) {
    endpointsReadable = false
    endpointProblems.push(
      restricted
        ? 'The webhook endpoint list could not be read. This is a restricted key, so it may simply lack that permission, which does not stop payments working. Check Developers then Webhooks in the Stripe dashboard by hand.'
        : 'The webhook endpoint list could not be read, so whether Stripe is pointed at this CRM is still unknown.'
    )
  } else {
    endpoints = readEndpoints(Array.isArray(list.data.data) ? list.data.data : [])
    const ours = endpoints.filter((e) => e.pointsHere)

    if (ours.length === 0) {
      endpointProblems.push(
        `Stripe has no webhook endpoint pointing at this CRM. Card payments would be taken and no order would ever appear here. Add an endpoint ending in ${WEBHOOK_PATH} in the Stripe dashboard under Developers then Webhooks, subscribe it to ${CHECKOUT_EVENT}, and put its signing secret in STRIPE_WEBHOOK_SECRET.`
      )
    } else {
      for (const endpoint of ours) {
        if (!endpoint.enabled) {
          endpointProblems.push(`The endpoint at ${endpoint.url} is disabled in Stripe, so it receives nothing.`)
        }
        if (!endpoint.listensForCheckout) {
          endpointProblems.push(
            `The endpoint at ${endpoint.url} is not subscribed to ${CHECKOUT_EVENT}, which is the only event that records a sale.`
          )
        }
      }
      if (ours.length > 1) {
        endpointProblems.push(
          `Stripe has ${ours.length} endpoints pointing at this CRM. Only one signing secret can be in STRIPE_WEBHOOK_SECRET, so the others would fail their signature check. Delete the ones you do not use.`
        )
      }
    }
  }

  return {
    configured: true,
    webhookSecretSet,
    mode,
    restricted,
    keyOk: true,
    accountName,
    accountId,
    endpoints,
    endpointsReadable,
    problems: [...keyProblems, ...endpointProblems, ...secretProblems],
  }
}
