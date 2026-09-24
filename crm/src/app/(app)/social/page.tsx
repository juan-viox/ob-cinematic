'use client'

/**
 * Write a social post, pick an account, send it now or put it on the calendar.
 *
 * Occasions Box plans Instagram in waves tied to the outreach schedule, which
 * until now meant somebody remembering to open the app on the right Thursday.
 * The scheduling half of this page is the point; posting immediately is the
 * easy case.
 *
 * The account list is read from Blotato rather than typed, because an account
 * id is a number nobody can sanity check by eye, and picking the wrong one
 * publishes correct copy to the wrong company.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Clock, Image as ImageIcon, Loader2, Send } from 'lucide-react'
import { withBasePath } from '@/lib/url'

interface Account {
  id: string
  platform: string
  name: string | null
}

interface Probe {
  configured: boolean
  keyOk: boolean | null
  accounts: Account[]
  problem: string | null
}

interface Sent {
  id: string | null
  scheduled: boolean
  scheduledTime: string | null
  platform: string
  mediaCount: number
}

/** Caption limits, so a post is rejected here rather than by the platform. */
const LIMITS: Record<string, number> = {
  twitter: 280,
  x: 280,
  bluesky: 300,
  mastodon: 500,
  instagram: 2200,
  threads: 500,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  pinterest: 500,
  youtube: 5000,
}

const MEDIA_REQUIRED = new Set(['instagram', 'tiktok', 'pinterest', 'youtube'])

function titleCase(s: string): string {
  return s ? `${s[0].toUpperCase()}${s.slice(1)}` : s
}

export default function SocialPage() {
  const [probe, setProbe] = useState<Probe | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [accountId, setAccountId] = useState('')
  const [text, setText] = useState('')
  const [mediaText, setMediaText] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('later')
  const [at, setAt] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(withBasePath('/api/v1/blotato/check'), { cache: 'no-store' })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const json = (await res.json()) as { probe: Probe }
      setProbe(json.probe)
      if (json.probe.accounts.length === 1) setAccountId(json.probe.accounts[0].id)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reach Blotato')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const account = useMemo(
    () => probe?.accounts.find((a) => a.id === accountId) ?? null,
    [probe, accountId]
  )
  const mediaUrls = useMemo(
    () => mediaText.split('\n').map((l) => l.trim()).filter(Boolean),
    [mediaText]
  )

  const limit = account ? LIMITS[account.platform] ?? null : null
  const over = limit != null && text.length > limit
  const needsMedia = account ? MEDIA_REQUIRED.has(account.platform) : false
  const missingMedia = needsMedia && mediaUrls.length === 0

  const ready =
    Boolean(account) &&
    !over &&
    !missingMedia &&
    (text.trim().length > 0 || mediaUrls.length > 0) &&
    (when === 'now' || at.length > 0)

  async function submit() {
    if (!account) return
    setBusy(true)
    setError(null)
    setSent(null)
    try {
      // datetime-local has no zone. Parsing it as local time and converting to
      // ISO is what the person meant: 9am means 9am where they are.
      const scheduledTime = when === 'later' && at ? new Date(at).toISOString() : null

      const res = await fetch(withBasePath('/api/v1/blotato/posts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          platform: account.platform,
          text,
          mediaUrls,
          scheduledTime,
        }),
      })
      const json = (await res.json()) as { post?: Sent; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `The server answered ${res.status}`)
      if (json.post) {
        setSent(json.post)
        setText('')
        setMediaText('')
        setAt('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The post could not be sent')
    } finally {
      setBusy(false)
    }
  }

  const blocked = probe && (!probe.configured || probe.keyOk === false || probe.accounts.length === 0)

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">Social</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Write a post and schedule it, through the social accounts connected in Blotato.
        </p>
      </div>

      {!probe && !loadError && (
        <div className="flex items-center gap-2 text-sm text-[var(--muted)] py-8">
          <Loader2 size={16} className="animate-spin" />
          Asking Blotato which accounts are connected…
        </div>
      )}

      {loadError && <Notice tone="bad" title="Could not reach Blotato" body={loadError} />}

      {blocked && (
        <Notice
          tone="warn"
          title={probe?.configured ? 'Blotato cannot post yet' : 'Blotato is not connected'}
          body={
            probe?.problem ??
            'Set BLOTATO_API_KEY on the ob-crm project in Vercel and redeploy, then connect your accounts in Blotato.'
          }
        />
      )}

      {probe && !blocked && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5">
          <Field label="Post to">
            <select
              id="social-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">Choose an account…</option>
              {probe.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {titleCase(a.platform)}
                  {a.name ? ` · ${a.name}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Caption"
            hint={
              limit != null ? (
                <span style={{ color: over ? 'var(--danger, #e17055)' : undefined }}>
                  {text.length} / {limit}
                </span>
              ) : null
            }
          >
            <textarea
              id="social-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="What is going out?"
              className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-none resize-y"
            />
          </Field>

          <Field
            label="Images"
            hint={<span className="text-[var(--muted)]">One URL per line</span>}
          >
            <textarea
              id="social-media"
              value={mediaText}
              onChange={(e) => setMediaText(e.target.value)}
              rows={2}
              placeholder="https://occasionsbox.com/images/hosts-delight.jpg"
              className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:border-[var(--accent)] focus:outline-none resize-y font-mono text-xs"
            />
            {mediaUrls.length > 0 && (
              <p className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-1.5">
                <ImageIcon size={12} />
                {mediaUrls.length} {mediaUrls.length === 1 ? 'image' : 'images'}, uploaded to Blotato when you send
              </p>
            )}
            {missingMedia && (
              <p className="text-xs mt-1.5" style={{ color: '#fdcb6e' }}>
                {titleCase(account?.platform ?? '')} will not accept a post without an image.
              </p>
            )}
          </Field>

          <Field label="When">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
                <input
                  type="radio"
                  name="social-when"
                  checked={when === 'later'}
                  onChange={() => setWhen('later')}
                />
                Schedule
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
                <input
                  type="radio"
                  name="social-when"
                  checked={when === 'now'}
                  onChange={() => setWhen('now')}
                />
                Post now
              </label>
              {when === 'later' && (
                <input
                  id="social-at"
                  type="datetime-local"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                />
              )}
            </div>
          </Field>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={submit}
              disabled={!ready || busy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : when === 'now' ? (
                <Send size={14} />
              ) : (
                <Clock size={14} />
              )}
              {when === 'now' ? 'Post now' : 'Schedule it'}
            </button>
            {when === 'now' && (
              <span className="text-xs" style={{ color: '#fdcb6e' }}>
                This publishes immediately.
              </span>
            )}
          </div>
        </div>
      )}

      {error && <Notice tone="bad" title="It did not send" body={error} />}

      {sent && (
        <Notice
          tone="good"
          title={
            sent.scheduled
              ? `Scheduled for ${new Date(sent.scheduledTime ?? '').toLocaleString()}`
              : 'Published.'
          }
          body={`${titleCase(sent.platform)}${sent.mediaCount ? `, ${sent.mediaCount} image${sent.mediaCount === 1 ? '' : 's'}` : ''}${
            sent.id ? `. Blotato reference ${sent.id}` : ''
          }`}
        />
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium text-[var(--text)]">{label}</span>
        {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Notice({
  tone,
  title,
  body,
}: {
  tone: 'good' | 'warn' | 'bad'
  title: string
  body: string
}) {
  const palette = {
    good: { bg: 'rgba(0,184,148,0.10)', border: 'rgba(0,184,148,0.35)', icon: <Check size={18} style={{ color: 'var(--success, #00b894)' }} /> },
    warn: { bg: 'rgba(253,203,110,0.10)', border: 'rgba(253,203,110,0.35)', icon: <AlertTriangle size={18} style={{ color: '#fdcb6e' }} /> },
    bad: { bg: 'rgba(225,112,85,0.10)', border: 'rgba(225,112,85,0.35)', icon: <AlertTriangle size={18} style={{ color: 'var(--danger, #e17055)' }} /> },
  }[tone]

  return (
    <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
      <span className="shrink-0 mt-0.5">{palette.icon}</span>
      <div className="text-sm min-w-0">
        <p className="font-medium text-[var(--text)]">{title}</p>
        <p className="text-[var(--muted)] mt-1 break-words">{body}</p>
      </div>
    </div>
  )
}
