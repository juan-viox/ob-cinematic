import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { payPalEnv } from '@/lib/paypal'

/**
 * GET /api/v1/settings/integrations
 *
 * What is actually wired up, read from the server's own environment.
 *
 * The page this feeds used to be a form that saved API keys into the
 * browser's localStorage and then showed a green "Connected" badge. Nothing
 * ever read them. A key typed there went nowhere, stayed in one person's
 * browser, and the badge said the opposite — so the one screen whose job is
 * to tell you whether payments are connected was the least trustworthy thing
 * in the CRM, and it invited somebody to paste a live payment secret into it.
 *
 * So this reports rather than collects. Secrets live in the hosting
 * environment, where the code can actually reach them; here we only ever say
 * whether each one is present. Values are returned only where the value is
 * not a secret and seeing it is the point — which address campaigns send
 * from, which inboxes get alerted, whether PayPal is pointed at live.
 */

export const dynamic = 'force-dynamic'

const set = (v: string | undefined): boolean => Boolean(v?.trim())
const show = (v: string | undefined): string | null => (v?.trim() ? v.trim() : null)

export interface IntegrationField {
  /** The environment variable, named so it can be found and set. */
  key: string
  label: string
  present: boolean
  /** Shown only for values that are not secret. */
  value?: string | null
  /** Whether the feature above is broken without it. */
  required: boolean
  note?: string
}

export interface IntegrationStatus {
  id: string
  name: string
  what: string
  /** What stops working while this is unconfigured. */
  consequence: string
  docsUrl: string
  fields: IntegrationField[]
}

export async function GET() {
  const session = await requireSession()
  if (!session.ok) return session.response

  const env = process.env

  const integrations: IntegrationStatus[] = [
    {
      id: 'paypal',
      name: 'PayPal',
      what: 'Confirms a shop order was really paid, and for how much, before anyone packs it.',
      consequence:
        'Orders arrive marked "Unverified" and have to be checked by hand in PayPal. Anyone who finds the checkout endpoint can file a fake paid order.',
      docsUrl: 'https://developer.paypal.com/dashboard/applications/live',
      fields: [
        { key: 'PAYPAL_CLIENT_ID', label: 'Client ID', present: set(env.PAYPAL_CLIENT_ID), required: true },
        { key: 'PAYPAL_SECRET', label: 'Secret', present: set(env.PAYPAL_SECRET), required: true },
        {
          key: 'PAYPAL_ENV',
          label: 'Environment',
          present: set(env.PAYPAL_ENV),
          value: show(env.PAYPAL_ENV) ?? `unset — defaulting to ${payPalEnv()}`,
          required: true,
          note: 'Must be "live". Unset means sandbox, where no real order exists.',
        },
      ],
    },
    {
      id: 'stripe',
      name: 'Stripe',
      what: 'Card checkout, and the webhook that files a Stripe sale as an order.',
      consequence: 'Card payments cannot be taken and Stripe sales never reach the CRM.',
      docsUrl: 'https://dashboard.stripe.com/apikeys',
      fields: [
        { key: 'STRIPE_SECRET_KEY', label: 'Secret key', present: set(env.STRIPE_SECRET_KEY), required: true },
        {
          key: 'STRIPE_WEBHOOK_SECRET',
          label: 'Webhook secret',
          present: set(env.STRIPE_WEBHOOK_SECRET),
          required: true,
          note: 'Without it the webhook refuses every event, including real payments.',
        },
      ],
    },
    {
      id: 'resend',
      name: 'Email',
      what: 'Order alerts, after-call notices, invoices and outreach campaigns.',
      consequence: 'Nothing is emailed: no order alert, no call notice, no campaign.',
      docsUrl: 'https://resend.com/api-keys',
      fields: [
        { key: 'RESEND_API_KEY', label: 'API key', present: set(env.RESEND_API_KEY), required: true },
        {
          key: 'RESEND_FROM_EMAIL',
          label: 'Sends from',
          present: set(env.RESEND_FROM_EMAIL),
          value: show(env.RESEND_FROM_EMAIL),
          required: true,
        },
        {
          key: 'ALERT_EMAILS',
          label: 'Order alerts go to',
          present: set(env.ALERT_EMAILS),
          value: show(env.ALERT_EMAILS),
          required: true,
          note: 'Comma separated. Empty means an order arrives and nobody is told.',
        },
        {
          key: 'CALL_NOTIFY_EMAILS',
          label: 'Call notices go to',
          present: set(env.CALL_NOTIFY_EMAILS),
          value: show(env.CALL_NOTIFY_EMAILS),
          required: false,
          note: 'Added to the order-alert list rather than replacing it.',
        },
        {
          key: 'RESEND_CAMPAIGN_FROM_EMAIL',
          label: 'Campaigns send from',
          present: set(env.RESEND_CAMPAIGN_FROM_EMAIL),
          value: show(env.RESEND_CAMPAIGN_FROM_EMAIL),
          required: false,
          note: 'Deliberately a different domain, so a cold-outreach complaint cannot bury order mail.',
        },
        {
          key: 'RESEND_CAMPAIGN_REPLY_TO',
          label: 'Campaign replies go to',
          present: set(env.RESEND_CAMPAIGN_REPLY_TO),
          value: show(env.RESEND_CAMPAIGN_REPLY_TO),
          required: false,
          note: 'The sending subdomain has no mailbox; without this, replies bounce.',
        },
      ],
    },
    {
      id: 'elevenlabs',
      name: 'Olivia (ElevenLabs)',
      what: 'Pulls in every call and chat Olivia handles, with the summary and transcript.',
      consequence: 'Calls still happen, but none of them are filed in the CRM.',
      docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
      fields: [
        { key: 'ELEVENLABS_API_KEY', label: 'API key', present: set(env.ELEVENLABS_API_KEY), required: true },
        {
          key: 'ELEVENLABS_AGENT_ID',
          label: 'Agent',
          present: set(env.ELEVENLABS_AGENT_ID),
          value: show(env.ELEVENLABS_AGENT_ID),
          required: true,
        },
        {
          key: 'SITE_API_KEY',
          label: 'Shared key for her tools',
          present: set(env.SITE_API_KEY),
          required: true,
          note: 'Must equal the x-api-key on her five ElevenLabs tools, or every lookup she makes fails.',
        },
        {
          key: 'CRON_SECRET',
          label: 'Scheduled sync',
          present: set(env.CRON_SECRET),
          required: true,
          note: 'Vercel sends this on each scheduled run; without it the sync refuses its own cron.',
        },
      ],
    },
    {
      id: 'twilio',
      name: 'Twilio',
      what: 'The text message sent to the team when an order arrives.',
      consequence: 'No order texts. Email and the in-CRM alert still work.',
      docsUrl: 'https://console.twilio.com/',
      fields: [
        { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', present: set(env.TWILIO_ACCOUNT_SID), required: true },
        { key: 'TWILIO_AUTH_TOKEN', label: 'Auth token', present: set(env.TWILIO_AUTH_TOKEN), required: true },
        {
          key: 'TWILIO_MESSAGING_SERVICE_SID',
          label: 'Messaging service',
          present: set(env.TWILIO_MESSAGING_SERVICE_SID),
          required: true,
        },
      ],
    },
    {
      id: 'supabase',
      name: 'Database',
      what: 'Everything. Contacts, orders, invoices, the catalogue.',
      consequence:
        'Without the service role key the CRM loads and looks healthy while every write silently fails.',
      docsUrl: 'https://supabase.com/dashboard/project/wztawjcxezojoqvpxvoa/settings/api',
      fields: [
        {
          key: 'SUPABASE_SERVICE_ROLE_KEY',
          label: 'Service role key',
          present: set(env.SUPABASE_SERVICE_ROLE_KEY),
          required: true,
        },
        {
          key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
          label: 'Publishable key',
          present: set(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
          required: true,
        },
      ],
    },
  ]

  return NextResponse.json({ integrations }, { headers: { 'Cache-Control': 'no-store' } })
}
