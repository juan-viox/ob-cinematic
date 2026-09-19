/**
 * Pulling Olivia's conversations out of ElevenLabs and filing them.
 *
 * The post-call webhook is the fast path, but it needs a signing secret that
 * can only be created in the ElevenLabs dashboard. This needs nothing but
 * ELEVENLABS_API_KEY, so the CRM records every call and emails the team
 * whether or not that webhook is ever configured. It is also what picks up a
 * call the webhook dropped, and what backfills the history.
 *
 * ELEVENLABS_API_KEY   the workspace API key (xi-api-key).
 * ELEVENLABS_AGENT_ID  optional; limits the sync to one agent. Without it
 *                      every agent in the workspace is synced.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConversationData } from '@/lib/record-conversation'
import { recordConversation } from '@/lib/record-conversation'

const API = 'https://api.elevenlabs.io/v1'
const FETCH_TIMEOUT_MS = 15_000

/** Conversations to consider in one run. Beyond this the run stops and the
 *  next one continues, so a long backlog never turns into a long request. */
const MAX_PER_RUN = 25

export interface ConversationSummary {
  conversation_id: string
  agent_id?: string
  start_time_unix_secs?: number
  call_duration_secs?: number
  status?: string
  direction?: string
}

export type SyncOutcome =
  | { ok: true; checked: number; filed: number; emailed: number; skipped: number }
  | { ok: false; status: number; error: string }

async function elevenLabsGet<T>(apiKey: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(`[elevenlabs:sync] GET ${path} failed:`, res.status)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error(`[elevenlabs:sync] GET ${path} error:`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function listConversations(
  apiKey: string,
  opts: { agentId?: string | null; sinceUnix: number; pageSize?: number }
): Promise<ConversationSummary[] | null> {
  const params = new URLSearchParams({
    page_size: String(Math.min(100, Math.max(1, opts.pageSize ?? 100))),
    call_start_after_unix: String(opts.sinceUnix),
  })
  if (opts.agentId) params.set('agent_id', opts.agentId)
  const json = await elevenLabsGet<{ conversations?: ConversationSummary[] }>(
    apiKey,
    `/convai/conversations?${params.toString()}`
  )
  if (!json) return null
  return Array.isArray(json.conversations) ? json.conversations : []
}

export function fetchConversation(apiKey: string, id: string): Promise<ConversationData | null> {
  return elevenLabsGet<ConversationData>(apiKey, `/convai/conversations/${encodeURIComponent(id)}`)
}

export interface SyncOptions {
  /** How far back to look for conversations. */
  sinceHours?: number
  /**
   * Only conversations that started within this many minutes get an email.
   * Older ones are filed quietly, so a first run over past calls does not
   * post a pile of mail about calls already dealt with.
   */
  notifyWithinMinutes?: number
}

/**
 * Files every conversation started in the window that the CRM has not seen.
 * Safe to run as often as you like: each conversation is filed once.
 */
export async function syncConversations(
  supabase: SupabaseClient,
  orgId: string,
  options: SyncOptions = {}
): Promise<SyncOutcome> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) return { ok: false, status: 503, error: 'ELEVENLABS_API_KEY is not configured' }
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim() || null

  const sinceHours = Math.min(24 * 30, Math.max(1, options.sinceHours ?? 24))
  const notifyWithinMinutes = Math.max(0, options.notifyWithinMinutes ?? 180)
  const now = Date.now()
  const sinceUnix = Math.floor((now - sinceHours * 3_600_000) / 1000)
  const notifyAfterUnix = Math.floor((now - notifyWithinMinutes * 60_000) / 1000)

  const summaries = await listConversations(apiKey, { agentId, sinceUnix })
  if (!summaries) return { ok: false, status: 502, error: 'Unable to reach ElevenLabs' }

  // Oldest first, so the CRM timeline fills in the order the calls happened.
  const ordered = [...summaries]
    .filter((c) => c.conversation_id && c.status !== 'in-progress' && c.status !== 'processing')
    .sort((a, b) => (a.start_time_unix_secs ?? 0) - (b.start_time_unix_secs ?? 0))
    .slice(0, MAX_PER_RUN)

  let filed = 0
  let emailed = 0
  let skipped = 0

  for (const summary of ordered) {
    const detail = await fetchConversation(apiKey, summary.conversation_id)
    if (!detail || !detail.conversation_id) {
      skipped++
      continue
    }
    const startedUnix = detail.metadata?.start_time_unix_secs ?? summary.start_time_unix_secs ?? 0
    try {
      const result = await recordConversation(supabase, orgId, detail, {
        via: 'elevenlabs_sync',
        notify: startedUnix >= notifyAfterUnix,
      })
      if (result.duplicate) skipped++
      else {
        filed++
        if (result.emailed) emailed++
      }
    } catch (err) {
      console.error('[elevenlabs:sync] failed to file', summary.conversation_id, err instanceof Error ? err.message : err)
      skipped++
    }
  }

  return { ok: true, checked: ordered.length, filed, emailed, skipped }
}
