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
 * PAYPAL_ENV selects the API host: 'live' → api-m.paypal.com,
 * anything else (default) → api-m.sandbox.paypal.com (the site currently
 * uses client-id=sb, i.e. the sandbox).
 */

export interface PayPalConfig {
  clientId: string
  secret: string
  baseUrl: string
}

export interface PayPalVerifiedOrder {
  id: string
  status: string
  amount: number | null
  currency: string | null
  payerEmail: string | null
  payerGivenName: string | null
  payerSurname: string | null
}

export type PayPalVerification =
  | { ok: true; order: PayPalVerifiedOrder }
  | { ok: false; status: number; error: string }

const FETCH_TIMEOUT_MS = 10_000

/** null when PayPal credentials are not configured. */
export function getPayPalConfig(): PayPalConfig | null {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const secret = process.env.PAYPAL_SECRET?.trim()
  if (!clientId || !secret) return null
  const env = (process.env.PAYPAL_ENV ?? 'sandbox').trim().toLowerCase()
  const baseUrl = env === 'live' || env === 'production' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  return { clientId, secret, baseUrl }
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
