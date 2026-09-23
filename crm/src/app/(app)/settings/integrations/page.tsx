'use client'

/**
 * What is connected, and what breaks while it is not.
 *
 * This page used to be a form. It collected API keys into the browser's
 * localStorage and showed a green "Connected" badge once you typed one.
 * Nothing on the server ever read them, so the badge was a lie, the key never
 * left that one browser, and the screen whose entire job is to tell you
 * whether payments work was inviting somebody to paste a live payment secret
 * somewhere it would never be used.
 *
 * It reports now instead of collecting. Secrets belong in the hosting
 * environment, which is the only place the running code can read them, so the
 * page says which are present, what each one is for, and what is broken while
 * it is missing. The one thing it can do beyond reporting is ask PayPal
 * whether the credentials actually work, because "unverified order" is the
 * same symptom for three very different mistakes, and guessing between them
 * over a real customer's payment is how an afternoon disappears.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, Minus, RefreshCw, Search, X } from 'lucide-react'
import { withBasePath } from '@/lib/url'

interface Field {
  key: string
  label: string
  present: boolean
  value?: string | null
  required: boolean
  note?: string
}

interface Integration {
  id: string
  name: string
  what: string
  consequence: string
  docsUrl: string
  fields: Field[]
}

interface BlotatoAccount {
  id: string
  platform: string
  name: string | null
}

interface BlotatoProbe {
  configured: boolean
  keyOk: boolean | null
  accounts: BlotatoAccount[]
  problem: string | null
}

interface StripeEndpoint {
  id: string
  url: string
  enabled: boolean
  events: string[]
  pointsHere: boolean
  listensForCheckout: boolean
}

interface StripeProbe {
  configured: boolean
  webhookSecretSet: boolean
  mode: 'live' | 'test' | 'unknown'
  restricted: boolean
  keyOk: boolean | null
  accountName: string | null
  accountId: string | null
  endpoints: StripeEndpoint[]
  endpointsReadable: boolean
  problems: string[]
}

interface Probe {
  configured: boolean
  env: 'live' | 'sandbox'
  envExplicit: boolean
  host: string
  clientId: string | null
  matchesShop: boolean | null
  credentialsOk: boolean | null
  problem: string | null
}

interface PayPalOrder {
  id: string
  status: string
  completed: boolean
  amount: number | null
  currency: string | null
  payerEmail: string | null
  payerName: string | null
  shipToName: string | null
  shipToAddress: Record<string, unknown> | null
}

interface CheckResult {
  probe: Probe
  order: PayPalOrder | null
  error?: string
}

/** Missing and required is a problem; missing and optional is a choice. */
function healthOf(i: Integration): 'ok' | 'broken' | 'partial' {
  const missingRequired = i.fields.filter((f) => f.required && !f.present)
  if (missingRequired.length === 0) return 'ok'
  if (missingRequired.length === i.fields.filter((f) => f.required).length) return 'broken'
  return 'partial'
}

const STATUS_STYLE: Record<'ok' | 'broken' | 'partial', { label: string; color: string; bg: string }> = {
  ok: { label: 'Connected', color: 'var(--success, #00b894)', bg: 'rgba(0,184,148,0.14)' },
  partial: { label: 'Incomplete', color: '#fdcb6e', bg: 'rgba(253,203,110,0.16)' },
  broken: { label: 'Not connected', color: 'var(--danger, #e17055)', bg: 'rgba(225,112,85,0.14)' },
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(withBasePath('/api/v1/settings/integrations'), { cache: 'no-store' })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const json = (await res.json()) as { integrations: Integration[] }
      setIntegrations(json.integrations)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the configuration')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const broken = (integrations ?? []).filter((i) => healthOf(i) !== 'ok')

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Integrations</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            What the CRM is connected to right now, read from the server. Keys are set on the hosting
            project, not typed here. This page tells you whether they arrived.
          </p>
        </div>
        <button
          onClick={load}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent)]/40 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {loadError && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ background: 'rgba(225,112,85,0.10)', border: '1px solid rgba(225,112,85,0.35)' }}
        >
          <p className="font-medium text-[var(--text)]">Could not read the configuration</p>
          <p className="text-[var(--muted)] mt-1">{loadError}</p>
        </div>
      )}

      {integrations && broken.length > 0 && (
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: 'rgba(253,203,110,0.10)', border: '1px solid rgba(253,203,110,0.35)' }}
        >
          <AlertTriangle size={18} className="shrink-0 mt-0.5" style={{ color: '#fdcb6e' }} />
          <div className="text-sm">
            <p className="font-medium text-[var(--text)]">
              {broken.length === 1 ? 'One integration needs attention' : `${broken.length} integrations need attention`}
            </p>
            <p className="text-[var(--muted)] mt-1">
              {broken.map((i) => i.name).join(', ')}. Each card below says what stops working until it is set.
            </p>
          </div>
        </div>
      )}

      {!integrations && !loadError && (
        <div className="flex items-center gap-2 text-sm text-[var(--muted)] py-8">
          <Loader2 size={16} className="animate-spin" />
          Reading the server configuration…
        </div>
      )}

      <div className="space-y-4">
        {(integrations ?? []).map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      {integrations && (
        <p className="text-xs text-[var(--muted)] leading-relaxed pt-2">
          To change any of these, set the named variable on the <code>ob-crm</code> project in Vercel
          (Settings → Environment Variables) and redeploy. Values marked as a secret are never shown here,
          or anywhere else in the CRM.
        </p>
      )}
    </div>
  )
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const health = healthOf(integration)
  const style = STATUS_STYLE[health]

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-medium text-[var(--text)]">{integration.name}</h2>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: style.bg, color: style.color }}
            >
              {style.label}
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">{integration.what}</p>
        </div>
        <a
          href={integration.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[var(--muted)] hover:text-[var(--accent)]"
          title="Where these come from"
        >
          <ExternalLink size={16} />
        </a>
      </div>

      {health !== 'ok' && (
        <p
          className="text-xs rounded-lg px-3 py-2 mb-4"
          style={{ background: 'rgba(225,112,85,0.08)', color: 'var(--text)' }}
        >
          <span className="font-medium">While this is unset: </span>
          {integration.consequence}
        </p>
      )}

      <div className="space-y-2">
        {integration.fields.map((field) => (
          <FieldRow key={field.key} field={field} />
        ))}
      </div>

      {integration.id === 'paypal' && <PayPalTester />}
      {integration.id === 'stripe' && <StripeTester />}
      {integration.id === 'blotato' && <BlotatoTester />}
    </div>
  )
}

function FieldRow({ field }: { field: Field }) {
  const icon = field.present ? (
    <Check size={13} style={{ color: 'var(--success, #00b894)' }} />
  ) : field.required ? (
    <X size={13} style={{ color: 'var(--danger, #e17055)' }} />
  ) : (
    <Minus size={13} style={{ color: 'var(--muted)' }} />
  )

  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="shrink-0 mt-1">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[var(--text)]">{field.label}</span>
          <code className="text-[10px] text-[var(--muted)]">{field.key}</code>
          {!field.required && !field.present && (
            <span className="text-[10px] text-[var(--muted)]">optional</span>
          )}
        </div>
        {field.value != null && (
          <p className="text-xs text-[var(--muted)] mt-0.5 break-words">{field.value}</p>
        )}
        {field.present && field.value == null && (
          <p className="text-xs text-[var(--muted)] mt-0.5">Set (hidden)</p>
        )}
        {field.note && <p className="text-[11px] text-[var(--muted)] mt-0.5 italic">{field.note}</p>}
      </div>
    </div>
  )
}

/**
 * The two questions worth asking PayPal directly.
 *
 * "Do these keys work" can be answered with no order and no money. "Does
 * PayPal know this order" needs a real one, and is the only thing that proves
 * the credentials belong to the merchant who actually took the payment,
 * which is the failure the credentials check cannot see.
 */
function PayPalTester() {
  const [result, setResult] = useState<CheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderId, setOrderId] = useState('')

  async function run(id?: string) {
    setBusy(true)
    setError(null)
    try {
      const url = withBasePath(`/api/v1/paypal/check${id ? `?orderId=${encodeURIComponent(id)}` : ''}`)
      const res = await fetch(url, { cache: 'no-store' })
      const json = (await res.json()) as CheckResult
      setResult(json)
      if (json.error) setError(json.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check could not run')
    } finally {
      setBusy(false)
    }
  }

  const probe = result?.probe
  const credentialsGood = probe?.configured && probe.credentialsOk && !probe.problem

  return (
    <div className="mt-5 pt-4 border-t border-[var(--border)] space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => run()}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Test the connection
        </button>
        <span className="text-xs text-[var(--muted)]">Asks PayPal directly. Costs nothing, changes nothing.</span>
      </div>

      {probe && (
        <div
          className="rounded-lg p-3 text-xs space-y-1.5"
          style={{
            background: credentialsGood ? 'rgba(0,184,148,0.08)' : 'rgba(225,112,85,0.08)',
            border: `1px solid ${credentialsGood ? 'rgba(0,184,148,0.3)' : 'rgba(225,112,85,0.3)'}`,
          }}
        >
          <p className="font-medium text-[var(--text)]">
            {credentialsGood
              ? `PayPal accepted these credentials on ${probe.env}.`
              : probe.configured
                ? 'PayPal is connected, but something is off.'
                : 'PayPal is not connected.'}
          </p>
          {probe.problem && <p className="text-[var(--muted)] leading-relaxed">{probe.problem}</p>}
          {probe.clientId && (
            <p className="text-[var(--muted)] break-all">
              Client ID: <code>{probe.clientId}</code>
              {probe.matchesShop === true && ' (matches the shop)'}
              {probe.matchesShop === false && ' (does NOT match the shop)'}
            </p>
          )}
        </div>
      )}

      {credentialsGood && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Now prove it against a real payment: paste a PayPal order id and see what PayPal says about it.
          </p>
          <div className="flex gap-2">
            <input
              id="paypal-order-id"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="e.g. 5O190127TN364715T"
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              onClick={() => run(orderId.trim())}
              disabled={busy || orderId.trim().length < 4}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]/40 disabled:opacity-40 transition-colors"
            >
              <Search size={14} />
              Look it up
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          className="text-xs rounded-lg px-3 py-2 leading-relaxed"
          style={{ background: 'rgba(225,112,85,0.10)', color: 'var(--text)' }}
        >
          {error}
        </p>
      )}

      {result?.order && (
        <div
          className="rounded-lg p-3 text-xs space-y-1"
          style={{
            background: result.order.completed ? 'rgba(0,184,148,0.08)' : 'rgba(253,203,110,0.10)',
            border: `1px solid ${result.order.completed ? 'rgba(0,184,148,0.3)' : 'rgba(253,203,110,0.35)'}`,
          }}
        >
          <p className="font-medium text-[var(--text)]">
            {result.order.completed
              ? 'PayPal confirms this order was completed.'
              : `PayPal has this order, but its status is ${result.order.status || 'unknown'}, not COMPLETED.`}
          </p>
          <p className="text-[var(--muted)]">
            {result.order.amount != null && `${result.order.amount.toFixed(2)} ${result.order.currency ?? ''} · `}
            {result.order.payerName ?? 'no payer name'}
            {result.order.payerEmail ? ` · ${result.order.payerEmail}` : ''}
          </p>
          {result.order.shipToName && (
            <p className="text-[var(--muted)]">Ships to {result.order.shipToName}</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Whether a card payment would actually become an order.
 *
 * Both keys showing green above is a weaker claim than it looks. The signing
 * secret can be valid and still belong to an endpoint pointing somewhere else,
 * and nothing here can tell, because the webhook that would have complained is
 * precisely the one that never arrives. The symptom is a customer who paid and
 * an Orders page that stays empty, discovered days later.
 *
 * So this shows the endpoints Stripe actually holds, where each points and
 * what it listens for, and says plainly when none of them is us.
 */
function StripeTester() {
  const [probe, setProbe] = useState<StripeProbe | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(withBasePath('/api/v1/stripe/check'), { cache: 'no-store' })
      const json = (await res.json()) as { probe?: StripeProbe; error?: string }
      if (!res.ok || !json.probe) throw new Error(json.error ?? `The server answered ${res.status}`)
      setProbe(json.probe)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check could not run')
    } finally {
      setBusy(false)
    }
  }

  const good = probe?.configured && probe.keyOk === true && probe.problems.length === 0
  const ours = (probe?.endpoints ?? []).filter((e) => e.pointsHere)

  return (
    <div className="mt-5 pt-4 border-t border-[var(--border)] space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={run}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Test the connection
        </button>
        <span className="text-xs text-[var(--muted)]">Asks Stripe directly. Takes no money, changes nothing.</span>
      </div>

      {probe && (
        <div
          className="rounded-lg p-3 text-xs space-y-1.5"
          style={{
            background: good ? 'rgba(0,184,148,0.08)' : 'rgba(225,112,85,0.08)',
            border: `1px solid ${good ? 'rgba(0,184,148,0.3)' : 'rgba(225,112,85,0.3)'}`,
          }}
        >
          <p className="font-medium text-[var(--text)]">
            {good
              ? 'Stripe is ready to take a card payment and record it as an order.'
              : probe.configured
                ? 'Stripe is configured, but a card sale would not reach the CRM.'
                : 'Stripe is not connected.'}
          </p>

          {probe.keyOk === true && (
            <p className="text-[var(--muted)]">
              {probe.accountName ?? 'Stripe account'}
              {probe.accountId ? ` · ${probe.accountId}` : ''}
              {` · ${probe.mode} mode`}
              {probe.restricted ? ' · restricted key' : ''}
            </p>
          )}

          {probe.problems.map((problem) => (
            <p key={problem} className="text-[var(--muted)] leading-relaxed">
              {problem}
            </p>
          ))}

          {probe.endpointsReadable && probe.endpoints.length > 0 && (
            <div className="pt-1 space-y-0.5">
              <p className="text-[var(--muted)]">
                {probe.endpoints.length === 1 ? 'One webhook endpoint' : `${probe.endpoints.length} webhook endpoints`} in
                Stripe:
              </p>
              <ul className="text-[var(--muted)] space-y-0.5">
                {probe.endpoints.map((endpoint) => (
                  <li key={endpoint.id} className="break-all">
                    {endpoint.pointsHere ? '→ ' : '· '}
                    <code>{endpoint.url}</code>
                    {!endpoint.enabled && ' (disabled)'}
                    {endpoint.pointsHere && endpoint.listensForCheckout && ' (this CRM, listening)'}
                    {endpoint.pointsHere && !endpoint.listensForCheckout && ' (this CRM, wrong events)'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {good && ours.length === 1 && (
            <p className="text-[var(--muted)] leading-relaxed pt-1">
              One thing this cannot prove: that the signing secret here belongs to that endpoint. Stripe shows an
              endpoint&apos;s secret only when it is created. A single real card payment settles it.
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          className="text-xs rounded-lg px-3 py-2 leading-relaxed"
          style={{ background: 'rgba(225,112,85,0.10)', color: 'var(--text)' }}
        >
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Whether Blotato will actually publish, which is two questions.
 *
 * A key that works is not the same as an account that is connected: a valid
 * key on a workspace with no Instagram attached fails at the moment a
 * scheduled post was due, long after anyone is watching. So this reports the
 * account list, not just a green tick.
 */
function BlotatoTester() {
  const [probe, setProbe] = useState<BlotatoProbe | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(withBasePath('/api/v1/blotato/check'), { cache: 'no-store' })
      const json = (await res.json()) as { probe?: BlotatoProbe; error?: string }
      if (!res.ok || !json.probe) throw new Error(json.error ?? `The server answered ${res.status}`)
      setProbe(json.probe)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check could not run')
    } finally {
      setBusy(false)
    }
  }

  const good = probe?.configured && probe.keyOk === true && !probe.problem

  return (
    <div className="mt-5 pt-4 border-t border-[var(--border)] space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={run}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Test the connection
        </button>
        <span className="text-xs text-[var(--muted)]">Asks Blotato directly. Posts nothing.</span>
      </div>

      {probe && (
        <div
          className="rounded-lg p-3 text-xs space-y-1.5"
          style={{
            background: good ? 'rgba(0,184,148,0.08)' : 'rgba(225,112,85,0.08)',
            border: `1px solid ${good ? 'rgba(0,184,148,0.3)' : 'rgba(225,112,85,0.3)'}`,
          }}
        >
          <p className="font-medium text-[var(--text)]">
            {good
              ? `Blotato accepted the key. ${probe.accounts.length} account${probe.accounts.length === 1 ? '' : 's'} connected.`
              : probe.configured
                ? 'Blotato is configured, but something is off.'
                : 'Blotato is not connected.'}
          </p>
          {probe.problem && <p className="text-[var(--muted)] leading-relaxed">{probe.problem}</p>}
          {probe.accounts.length > 0 && (
            <ul className="text-[var(--muted)] space-y-0.5 pt-1">
              {probe.accounts.map((a) => (
                <li key={a.id}>
                  {a.platform}
                  {a.name ? ` · ${a.name}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p
          className="text-xs rounded-lg px-3 py-2 leading-relaxed"
          style={{ background: 'rgba(225,112,85,0.10)', color: 'var(--text)' }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
