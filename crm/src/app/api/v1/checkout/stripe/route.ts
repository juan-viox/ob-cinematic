import {
  authorizeIngest,
  errorResponse,
  getIngestClient,
  getOrgId,
  handleOptions,
  isAllowedHost,
  isSpam,
  jsonError,
  jsonOk,
  readJsonBody,
  requestOrigin,
} from '@/lib/ingest'
import { createCheckoutSession, getStripeConfig } from '@/lib/stripe'
import { lineLabel, parseCartLines, type OrderLine } from '@/lib/record-order'

/** Where the buyer comes back to. Preview hosts of the shop are allowed
 *  origins, so a cart on one of them returns there; anything else, or a
 *  request from the CRM's own host, goes to the shop itself. */
const SHOP_URL = 'https://occasionsbox.com'

/** Same rate and rounding as the cart (site/assets/js/site.js) and the
 *  PayPal order: one rounding on the whole order, not one per line. */
const PROCESSING_RATE = 0.03
const PROCESSING_LABEL = 'Processing & Handling'

/** What a static site can put in front of Stripe: the cart, priced from the
 *  catalogue here, never from the browser. */
const MAX_CHECKOUT_LINES = 20

function returnSite(request: Request): string {
  const origin = requestOrigin(request)
  if (!origin || !isAllowedHost(origin.host)) return SHOP_URL
  if (origin.host.startsWith('crm.') || origin.host.startsWith('ob-crm')) return SHOP_URL
  return origin.origin
}

export function OPTIONS(request: Request) {
  return handleOptions(request)
}

/**
 * POST /api/v1/checkout/stripe
 *
 * Body: { items: [{ name, variant?, card?, message?, unitAmount, quantity }, …] }
 *
 * Every line is priced from the catalogue. A name the catalogue does not
 * carry, or a unitAmount that disagrees with it, is refused: the first is a
 * stale cart, the second is a stale page or a tampered request, and either
 * way the buyer must not be charged a number nobody on the team set.
 *
 * Returns { url } for the hosted Stripe Checkout page. The order is recorded
 * when Stripe confirms payment to /api/v1/webhooks/stripe, never from here.
 */
export async function POST(request: Request) {
  try {
    const auth = authorizeIngest(request)
    if (!auth.ok) return jsonError(request, auth.error, auth.status)

    const body = await readJsonBody(request)
    if (isSpam(body)) return jsonError(request, 'Unable to start checkout', 400)

    const parsed = parseCartLines(body.items ?? body.lineItems)
    if (typeof parsed === 'string') return jsonError(request, parsed, 400)
    if (!parsed) return jsonError(request, 'items is required', 400)
    if (parsed.length > MAX_CHECKOUT_LINES) {
      return jsonError(request, `items may contain at most ${MAX_CHECKOUT_LINES} lines`, 400)
    }

    // Both halves or neither. The session is what takes the money and the
    // webhook is what records the order, so a secret key without a signing
    // secret is a shop that can charge a buyer and keep no record of what
    // they bought. Refuse the session instead: PayPal still works, and the
    // button says so.
    const stripe = getStripeConfig()
    if (!stripe || !stripe.webhookSecret) {
      if (stripe) {
        console.error('[checkout:stripe] STRIPE_WEBHOOK_SECRET is not set; refusing to take a payment we cannot record')
      }
      return jsonError(request, 'Card checkout is not set up yet. Please pay with PayPal.', 503)
    }

    const supabase = getIngestClient()
    const orgId = await getOrgId(supabase)

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('name, price, is_active, image_url')
      .eq('organization_id', orgId)
    if (productsError) {
      console.error('[checkout:stripe] catalogue lookup failed:', productsError.message)
      return jsonError(request, 'Unable to price the cart', 500)
    }
    const catalogue = new Map<string, { price: number; active: boolean; image: string | null }>()
    for (const p of (products ?? []) as Array<{ name: string; price: number | string | null; is_active: boolean | null; image_url: string | null }>) {
      catalogue.set(p.name.trim().toLowerCase(), {
        price: Number(p.price ?? 0),
        active: p.is_active !== false,
        image: typeof p.image_url === 'string' && /^https:\/\//.test(p.image_url) ? p.image_url : null,
      })
    }

    const lines: OrderLine[] = []
    let itemCents = 0
    for (const line of parsed) {
      const product = catalogue.get(line.name.trim().toLowerCase())
      if (!product || !product.active) {
        return jsonError(request, `We no longer sell "${line.name}". Remove it from your cart and try again.`, 400)
      }
      if (Math.abs(product.price - line.unitAmount) > 0.005) {
        return jsonError(request, `The price of "${line.name}" has changed. Refresh the page and try again.`, 400)
      }
      lines.push({ ...line, unitAmount: product.price })
      itemCents += Math.round(product.price * 100) * line.quantity
    }
    const feeCents = Math.round(itemCents * PROCESSING_RATE)
    const units = lines.reduce((n, line) => n + line.quantity, 0)
    const description = lines.length === 1
      ? `${lineLabel(lines[0])} Gift Box`
      : `Occasions Box: ${units} gift boxes`

    const site = returnSite(request)
    const lineItems: Array<Record<string, unknown>> = lines.map((line) => {
      const product = catalogue.get(line.name.trim().toLowerCase())
      const note = [line.card, line.cardMessage && `"${line.cardMessage}"`].filter(Boolean).join(' - ')
      return {
        quantity: line.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(line.unitAmount * 100),
          product_data: {
            name: lineLabel(line).slice(0, 250),
            ...(note ? { description: note.slice(0, 500) } : {}),
            ...(product?.image ? { images: [product.image] } : {}),
            // The card and the message ride here so the webhook can read
            // them back off the line items; a session's own metadata cannot
            // hold twenty lines.
            metadata: {
              kind: 'box',
              name: line.name.slice(0, 500),
              variant: (line.variant ?? '').slice(0, 500),
              card: (line.card ?? '').slice(0, 500),
              message: (line.cardMessage ?? '').slice(0, 500),
            },
          },
        },
      }
    })
    if (feeCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: feeCents,
          product_data: {
            name: `${PROCESSING_LABEL} (3%)`,
            metadata: { kind: 'processing' },
          },
        },
      })
    }

    const session = await createCheckoutSession(stripe, {
      mode: 'payment',
      submit_type: 'pay',
      success_url: `${site}/shop?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/shop?checkout=cancelled`,
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ['US'] },
      phone_number_collection: { enabled: true },
      billing_address_collection: 'auto',
      custom_fields: [
        {
          key: 'delivery_date',
          label: { type: 'custom', custom: 'Requested delivery date' },
          type: 'text',
          optional: true,
        },
        {
          key: 'recipient_name',
          label: { type: 'custom', custom: 'Recipient name (if a gift)' },
          type: 'text',
          optional: true,
        },
      ],
      metadata: {
        source: 'occasionsbox.com',
        subtotal_cents: String(itemCents),
        processing_fee_cents: String(feeCents),
        processing_label: PROCESSING_LABEL,
        lines: String(lines.length),
        // Read back by the webhook. Only the literal 'yes' means texts.
        sms_consent: body.smsConsent === true ? 'yes' : 'no',
      },
      payment_intent_data: {
        description: description.slice(0, 200),
        metadata: { source: 'occasionsbox.com' },
      },
    })
    if (!session.ok) return jsonError(request, session.error, session.status)
    if (!session.data.url) return jsonError(request, 'Stripe did not return a checkout page', 502)

    return jsonOk(request, { success: true, url: session.data.url, sessionId: session.data.id })
  } catch (err) {
    return errorResponse(request, err, 'checkout:stripe')
  }
}
