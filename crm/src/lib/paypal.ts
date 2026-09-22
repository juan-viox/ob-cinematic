/**
 * Server-side PayPal order verification for /api/v1/ingest/order.
 *
 * The ingest origin check is only the (spoofable) Origin header, so an order
 * POST from the marketing site must never be trusted on its own: anyone could
 * create an "Approved / paid" deal with curl. With PAYPAL_CLIENT_ID and
 * PAYPAL_SECRET configured, the route fetches the order from PayPal and
 * requires status COMPLETED plus a matching amount/currency; the payer email
 * is taken from PayPal's response, not from the request body.
 *
 * PAYPAL_ENV selects the API host: 'live' or 'production' → api-m.paypal.com,
 * anything else, INCLUDING UNSET → api-m.sandbox.paypal.com.
 *
 * Set it deliberately. The shop loads the PayPal SDK with a real client id
 * (site/shop.html and every site/shop/*.html use client-id=BAAxKYq3MeBz…, not
 * the `sb` sandbox placeholder), so if that id belongs to a live PayPal app,
 * leaving PAYPAL_ENV unset points verification at the sandbox and every real
 * order fails to verify and lands as "Unverified order: …". Confirm which
 * account issued that client id in the PayPal dashboard, then set this to
 * match. An earlier version of this comment claimed the site used client-id=sb;
 * it does not.
 */

/**
 * The client id the shop's PayPal SDK loads with, taken from site/shop.html
 * and every site/shop/*.html. It is public by design, since it ships in the
 * page source where anyone can read it, and it lives here so the settings page
 * can answer the one question that decides whether verification will work at
 * all: do the credentials doing the verifying belong to the same PayPal app
 * that takes the money?
 *
 * They have to. GET /v2/checkout/orders/{id} only answers for the merchant
 * that owns the order, so a secret from a different app verifies nothing and
 * fails with a 404 that reads exactly like a mistyped order id. That is a
 * genuinely confusing hour to lose, and comparing two strings prevents it.
 *
 * If the shop's SDK tag ever changes, change this with it.
 */
export const SHOP_PAYPAL_CLIENT_ID =
  'BAAxKYq3MeBz4sApUR0urJqOFrN8VZnJ9Oc5MUlUGlEo1Ts_fnFtZM7SixXtLZB6tSJiM_uql2IjEBA7Y0'

export interface PayPalConfig {
  clientId: string
  secret: string
  baseUrl: string
  /** Which PayPal the baseUrl points at, for saying so out loud. */
  env: 'live' | 'sandbox'
}

export interface PayPalVerifiedOrder {
  id: string
  status: string
  amount: number | null
  currency: string | null
  payerEmail: string | null
  payerGivenName: string | null
  payerSurname: string | null
  /** Where PayPal says the order ships, when the buyer gave an address. */
  shipToName: string | null
  shipToAddress: Record<string, unknown> | null
}

export type PayPalVerification =
  | { ok: true; order: PayPalVerifiedOrder }
  | { ok: false; status: number; error: string }

const FETCH_TIMEOUT_MS = 10_000

/** Which PayPal PAYPAL_ENV selects. Unset means sandbox; see the file header. */
export function payPalEnv(): 'live' | 'sandbox' {
  const raw = (process.env.PAYPAL_ENV ?? 'sandbox').trim().toLowerCase()
  return raw === 'live' || raw === 'production' ? 'live' : 'sandbox'
}

/** null when PayPal credentials are not configured. */
export function getPayPalConfig(): PayPalConfig | null {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const secret = process.env.PAYPAL_SECRET?.trim()
  if (!clientId || !secret) return null
  const env = payPalEnv()
  const baseUrl = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  return { clientId, secret, baseUrl, env }
}

/** What the settings page needs to say about PayPal, with no secret in it. */
export interface PayPalProbe {
  /** Both PAYPAL_CLIENT_ID and PAYPAL_SECRET are present. */
  configured: boolean
  env: 'live' | 'sandbox'
  /** false when PAYPAL_ENV is unset and we defaulted: the quiet failure. */
  envExplicit: boolean
  host: string
  /** Safe to show: a client id is public, it ships in the shop's page source. */
  clientId: string | null
  /** Whether that client id is the one the shop checks out with. */
  matchesShop: boolean | null
  /** null when not configured; otherwise whether PayPal accepted the pair. */
  credentialsOk: boolean | null
  /** Plain-English problem, or null when there is nothing to report. */
  problem: string | null
}

/**
 * Asks PayPal whether the configured credentials are real, without touching
 * an order or a penny.
 *
 * This exists because the three ways PayPal verification fails look identical
 * from the CRM, an order that lands "Unverified", and cost very different
 * amounts of time to fix: the keys are missing, the keys are for the wrong
 * PayPal (sandbox credentials against live orders), or the keys are for the
 * right PayPal but a different app than the shop checks out with. Separating
 * them before the first real order means nobody debugs a live sale.
 */
export async function probePayPal(): Promise<PayPalProbe> {
  const env = payPalEnv()
  const envExplicit = Boolean(process.env.PAYPAL_ENV?.trim())
  const host = env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  const config = getPayPalConfig()

  if (!config) {
    const hasId = Boolean(process.env.PAYPAL_CLIENT_ID?.trim())
    const hasSecret = Boolean(process.env.PAYPAL_SECRET?.trim())
    return {
      configured: false,
      env,
      envExplicit,
      host,
      clientId: hasId ? (process.env.PAYPAL_CLIENT_ID as string).trim() : null,
      matchesShop: null,
      credentialsOk: null,
      problem:
        hasId && !hasSecret
          ? 'PAYPAL_SECRET is missing. The client id is set on its own, which does nothing.'
          : !hasId && hasSecret
            ? 'PAYPAL_CLIENT_ID is missing. The secret is set on its own, which does nothing.'
            : 'PayPal is not connected, so paid orders arrive marked unverified and have to be checked by hand.',
    }
  }

  const matchesShop = config.clientId === SHOP_PAYPAL_CLIENT_ID
  const token = await getAccessToken(config)

  let problem: string | null = null
  if (!token) {
    problem = `PayPal rejected these credentials on ${host}. Either the client id and secret do not go together, or they belong to the other environment (${env === 'live' ? 'a sandbox app cannot be used with PAYPAL_ENV=live' : 'PAYPAL_ENV is not set to live, so live credentials are being sent to the sandbox'}).`
  } else if (!envExplicit) {
    problem =
      'PAYPAL_ENV is not set, so verification is pointed at the PayPal sandbox. Real orders will not be found there. Set it to live.'
  } else if (!matchesShop) {
    problem =
      'These credentials work, but they are for a different PayPal app than the shop checks out with, so order lookups are likely to come back "not found". Use the app whose client id matches the shop, or update the shop to match.'
  }

  return {
    configured: true,
    env,
    envExplicit,
    host,
    clientId: config.clientId,
    matchesShop,
    credentialsOk: Boolean(token),
    problem,
  }
}

async function getAccessToken(config: PayPalConfig): Promise<string | null> {
  const basic = Buffer.from(`${config.clientId}:${config.secret}`).toString('base64')
  try {
    const res = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('[paypal] token request failed:', res.status)
      return null
    }
    const json = (await res.json()) as { access_token?: unknown }
    return typeof json.access_token === 'string' && json.access_token ? json.access_token : null
  } catch (err) {
    console.error('[paypal] token request error:', err instanceof Error ? err.message : err)
    return null
  }
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Fetches GET /v2/checkout/orders/{id} and normalizes the fields we verify. */
export async function fetchPayPalOrder(config: PayPalConfig, orderId: string): Promise<PayPalVerification> {
  const token = await getAccessToken(config)
  if (!token) return { ok: false, status: 502, error: 'Unable to verify order with PayPal' }

  let res: Response
  try {
    res = await fetch(`${config.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[paypal] order lookup error:', err instanceof Error ? err.message : err)
    return { ok: false, status: 502, error: 'Unable to verify order with PayPal' }
  }

  if (res.status === 404) return { ok: false, status: 400, error: 'PayPal order not found' }
  if (!res.ok) {
    console.error('[paypal] order lookup failed:', res.status)
    return { ok: false, status: 502, error: 'Unable to verify order with PayPal' }
  }

  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, status: 502, error: 'Unable to verify order with PayPal' }
  }

  const units = Array.isArray(json.purchase_units) ? (json.purchase_units as Array<Record<string, unknown>>) : []
  const amountObj = (units[0]?.amount ?? null) as { value?: unknown; currency_code?: unknown } | null
  const amountValue = amountObj ? Number(readString(amountObj.value)) : NaN
  const payer = (json.payer ?? null) as { email_address?: unknown; name?: { given_name?: unknown; surname?: unknown } } | null
  const shipping = (units[0]?.shipping ?? null) as { name?: { full_name?: unknown }; address?: unknown } | null

  return {
    ok: true,
    order: {
      id: readString(json.id) ?? orderId,
      status: readString(json.status) ?? '',
      amount: Number.isFinite(amountValue) ? amountValue : null,
      currency: amountObj ? readString(amountObj.currency_code)?.toUpperCase() ?? null : null,
      payerEmail: payer ? readString(payer.email_address)?.toLowerCase() ?? null : null,
      payerGivenName: payer?.name ? readString(payer.name.given_name) : null,
      payerSurname: payer?.name ? readString(payer.name.surname) : null,
      shipToName: shipping?.name ? readString(shipping.name.full_name) : null,
      shipToAddress: shipping?.address && typeof shipping.address === 'object' ? (shipping.address as Record<string, unknown>) : null,
    },
  }
}

/**
 * Verifies that the PayPal order is COMPLETED and that its amount/currency
 * match what the caller claims. Returns the verified order on success.
 */
export async function verifyPayPalOrder(
  config: PayPalConfig,
  orderId: string,
  expected: { amount: number; currency: string }
): Promise<PayPalVerification> {
  const result = await fetchPayPalOrder(config, orderId)
  if (!result.ok) return result
  const { order } = result

  if (order.status !== 'COMPLETED') {
    return { ok: false, status: 400, error: `PayPal order is not completed (status: ${order.status || 'unknown'})` }
  }
  if (order.amount === null || Math.abs(order.amount - expected.amount) > 0.005) {
    return { ok: false, status: 400, error: 'Order amount does not match PayPal' }
  }
  if (!order.currency || order.currency !== expected.currency) {
    return { ok: false, status: 400, error: 'Order currency does not match PayPal' }
  }
  return result
}
