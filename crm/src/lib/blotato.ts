/**
 * Blotato: publish and schedule social posts from inside the CRM.
 *
 * Occasions Box already pays for Blotato, and its key has been sitting in the
 * Vercel environment since 17 September 2026 with nothing reading it. This is
 * the code that reads it.
 *
 * What Blotato is: one API in front of the social accounts (Instagram,
 * Facebook, LinkedIn, X, TikTok and friends), so the CRM never holds a single
 * social password and never implements Instagram's own publishing flow, which
 * is its own small career.
 *
 * Endpoints used, all under https://backend.blotato.com:
 *   GET  /v2/users/me/accounts   which accounts are connected
 *   POST /v2/media               hand it a public URL, get back a hosted one
 *   POST /v2/posts               publish now, or schedule for later
 *
 * Authentication is the header `blotato-api-key`. Blotato's own documentation
 * is emphatic that the key must be sent exactly as issued, including any
 * trailing '=' padding, and must not be stripped or URL encoded. trim() below
 * removes surrounding whitespace only, which is what a copy and paste adds;
 * '=' is not whitespace, so padding survives.
 *
 * ONE THING NOT VERIFIED AGAINST A LIVE ACCOUNT: the exact field names Blotato
 * returns when listing accounts. The paths, the auth header and the publish
 * body below are from Blotato's published API reference. The account list is
 * parsed leniently for that reason, and the check route returns Blotato's raw
 * response alongside the parsed version, so the first real call tells us the
 * shape instead of us guessing at it. Tighten readAccounts() once we have seen
 * one.
 */

const BASE_URL = 'https://backend.blotato.com'
const FETCH_TIMEOUT_MS = 15_000

/** Platforms whose posts must carry at least one image or video. */
const MEDIA_REQUIRED = new Set(['instagram', 'tiktok', 'pinterest', 'youtube'])

export interface BlotatoConfig {
  apiKey: string
}

/** null when BLOTATO_API_KEY is not set. */
export function getBlotatoConfig(): BlotatoConfig | null {
  // Whitespace only. Never strip '=' padding; see the file header.
  const apiKey = process.env.BLOTATO_API_KEY?.trim()
  if (!apiKey) return null
  return { apiKey }
}

export interface BlotatoAccount {
  id: string
  platform: string
  /** Display name or handle, whichever Blotato gave us. */
  name: string | null
}

export interface BlotatoProbe {
  configured: boolean
  /** null when not configured; otherwise whether Blotato accepted the key. */
  keyOk: boolean | null
  accounts: BlotatoAccount[]
  /** Blotato's own response, unparsed, so an unexpected shape is visible. */
  raw: unknown
  /** Plain-English problem, or null when there is nothing to report. */
  problem: string | null
}

type BlotatoResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function headers(config: BlotatoConfig): Record<string, string> {
  return {
    'blotato-api-key': config.apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

async function call<T>(
  config: BlotatoConfig,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<BlotatoResult<T>> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: headers(config),
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    console.error('[blotato] request error:', err instanceof Error ? err.message : err)
    return { ok: false, status: 502, error: 'Could not reach Blotato' }
  }

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  if (!res.ok) {
    // Blotato reports the useful part in a message/error field; keep it, since
    // "rate limited" and "that account is disconnected" need different fixes.
    const detail = field(json, 'message') ?? field(json, 'error')
    console.error('[blotato] request failed:', res.status, detail ?? '')
    return {
      ok: false,
      status: res.status,
      error:
        res.status === 401 || res.status === 403
          ? 'Blotato rejected the API key.'
          : res.status === 429
            ? 'Blotato is rate limiting us. Posting is capped at 30 a minute.'
            : detail || `Blotato answered ${res.status}.`,
    }
  }

  return { ok: true, data: json as T }
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** A string field off an unknown payload, or null. Never throws. */
function field(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object') return null
  return readString((payload as Record<string, unknown>)[key])
}

/**
 * Pull an account list out of whatever Blotato hands back.
 *
 * Deliberately forgiving: it accepts a bare array, or an object wrapping one
 * under any of the usual keys, and takes the first plausible field for the id,
 * the platform and the name. A rigid parser here would turn one renamed field
 * into an empty dropdown with no explanation, which is the worst outcome for
 * somebody who just wants to post to Instagram.
 */
function readAccounts(payload: unknown): BlotatoAccount[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((): unknown[] => {
          const obj = payload as Record<string, unknown>
          for (const key of ['items', 'accounts', 'data', 'results']) {
            if (Array.isArray(obj[key])) return obj[key] as unknown[]
          }
          return []
        })()
      : []

  const accounts: BlotatoAccount[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id =
      readString(row.id) ?? readString(row.accountId) ?? readString(row.account_id) ?? null
    if (!id) continue
    const platform =
      readString(row.platform) ??
      readString(row.targetType) ??
      readString(row.type) ??
      'unknown'
    const name =
      readString(row.username) ??
      readString(row.handle) ??
      readString(row.name) ??
      readString(row.displayName) ??
      null
    accounts.push({ id, platform: platform.toLowerCase(), name })
  }
  return accounts
}

/**
 * Asks Blotato whether the key works and which accounts are connected.
 *
 * Posts nothing. This is the difference between "Blotato is configured" and
 * "Blotato will actually publish to Instagram on Thursday", which are not the
 * same claim: a valid key with no connected Instagram account fails at the
 * moment it matters instead of here.
 */
export async function probeBlotato(): Promise<BlotatoProbe> {
  const config = getBlotatoConfig()
  if (!config) {
    return {
      configured: false,
      keyOk: null,
      accounts: [],
      raw: null,
      problem: 'BLOTATO_API_KEY is not set, so nothing can be posted or scheduled from here.',
    }
  }

  const result = await call<unknown>(config, '/v2/users/me/accounts')
  if (!result.ok) {
    return { configured: true, keyOk: false, accounts: [], raw: null, problem: result.error }
  }

  const accounts = readAccounts(result.data)
  return {
    configured: true,
    keyOk: true,
    accounts,
    raw: result.data,
    problem:
      accounts.length === 0
        ? 'Blotato accepted the key but reports no connected accounts. Connect Instagram in Blotato before scheduling anything.'
        : null,
  }
}

/**
 * Hands Blotato a public image URL and gets back one it hosts.
 *
 * Most platforms refuse a URL they cannot themselves fetch, so posting a link
 * to our own site's image is not reliable. Running it through here first is.
 */
export async function uploadMedia(config: BlotatoConfig, url: string): Promise<BlotatoResult<string>> {
  const result = await call<unknown>(config, '/v2/media', { method: 'POST', body: { url } })
  if (!result.ok) return result

  const hosted = field(result.data, 'url') ?? field(result.data, 'mediaUrl')

  if (!hosted) {
    return { ok: false, status: 502, error: 'Blotato accepted the image but did not return a URL for it.' }
  }
  return { ok: true, data: hosted }
}

export interface PublishRequest {
  accountId: string
  /** Blotato's platform key, e.g. 'instagram'. Also used as the target type. */
  platform: string
  text: string
  mediaUrls: string[]
  /** ISO 8601. Omitted or null publishes immediately. */
  scheduledTime?: string | null
}

export interface PublishedPost {
  id: string | null
  scheduled: boolean
  raw: unknown
}

/** Everything wrong with a post that we can catch before spending an API call. */
export function validatePublishRequest(req: PublishRequest): string | null {
  if (!req.accountId) return 'Choose which account to post to.'
  if (!req.platform) return 'Choose a platform.'
  if (!req.text.trim() && req.mediaUrls.length === 0) return 'A post needs text, an image, or both.'
  if (MEDIA_REQUIRED.has(req.platform) && req.mediaUrls.length === 0) {
    return `${req.platform[0].toUpperCase()}${req.platform.slice(1)} will not accept a post without an image or video.`
  }
  if (req.scheduledTime) {
    const when = Date.parse(req.scheduledTime)
    if (Number.isNaN(when)) return 'That scheduled time is not a valid date.'
    if (when <= Date.now()) return 'That scheduled time is in the past.'
  }
  return null
}

/**
 * Publishes now, or schedules for later.
 *
 * The shape of this body matters more than it looks. `scheduledTime` belongs
 * at the TOP level, as a sibling of `post`. Blotato's documentation calls this
 * out because nesting it inside `post` does not error: the post simply
 * publishes immediately. For a business whose Instagram plan is built around
 * posting on a specific Thursday, a silent "now" is the expensive failure, so
 * the two fields are assembled separately below and never merged.
 */
export async function publishPost(
  config: BlotatoConfig,
  req: PublishRequest
): Promise<BlotatoResult<PublishedPost>> {
  const body: Record<string, unknown> = {
    post: {
      accountId: req.accountId,
      content: {
        text: req.text,
        mediaUrls: req.mediaUrls,
        platform: req.platform,
      },
      target: { targetType: req.platform },
    },
  }
  if (req.scheduledTime) body.scheduledTime = req.scheduledTime

  const result = await call<unknown>(config, '/v2/posts', { method: 'POST', body })
  if (!result.ok) return result

  const id = field(result.data, 'id') ?? field(result.data, 'postId')

  return { ok: true, data: { id, scheduled: Boolean(req.scheduledTime), raw: result.data } }
}
