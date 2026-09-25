import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'
import {
  getBlotatoConfig,
  publishPost,
  uploadMedia,
  validatePublishRequest,
  type PublishRequest,
} from '@/lib/blotato'

/**
 * POST /api/v1/blotato/posts
 *
 * Publish to a connected social account now, or schedule it for later.
 *
 * Restricted to owner and admin. Everything else in this CRM writes to our own
 * database, where a mistake is a row somebody can fix. This one writes to the
 * company's public Instagram, where a mistake is a screenshot, so it is not a
 * thing every account should be able to do by finding the URL.
 *
 * Images are run through Blotato's own media endpoint before posting rather
 * than passed straight through. Most platforms refuse a URL they cannot fetch
 * themselves, so a link to our own site is not dependable; a Blotato-hosted
 * one is.
 */

export const dynamic = 'force-dynamic'

interface Body {
  accountId?: unknown
  pageId?: unknown
  platform?: unknown
  text?: unknown
  mediaUrls?: unknown
  scheduledTime?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export async function POST(request: Request) {
  const session = await requireRole(['owner', 'admin'])
  if (!session.ok) return session.response

  const config = getBlotatoConfig()
  if (!config) {
    return NextResponse.json(
      { error: 'Blotato is not connected. Set BLOTATO_API_KEY on the ob-crm project and redeploy.' },
      { status: 503 }
    )
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const sourceUrls = Array.isArray(body.mediaUrls)
    ? body.mediaUrls.map(str).filter(Boolean).slice(0, 10)
    : []

  const draft: PublishRequest = {
    accountId: str(body.accountId),
    pageId: str(body.pageId) || null,
    platform: str(body.platform).toLowerCase(),
    text: typeof body.text === 'string' ? body.text : '',
    mediaUrls: sourceUrls,
    scheduledTime: str(body.scheduledTime) || null,
  }

  // Validate against the source URLs first, so "Instagram needs an image" is
  // reported before we spend an upload call finding out.
  const invalid = validatePublishRequest(draft)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  const hosted: string[] = []
  for (const url of sourceUrls) {
    const upload = await uploadMedia(config, url)
    if (!upload.ok) {
      return NextResponse.json(
        { error: `Could not upload ${url} to Blotato: ${upload.error}` },
        { status: upload.status === 429 ? 429 : 502 }
      )
    }
    hosted.push(upload.data)
  }

  const result = await publishPost(config, { ...draft, mediaUrls: hosted })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status === 429 ? 429 : 502 })
  }

  return NextResponse.json({
    post: {
      id: result.data.id,
      scheduled: result.data.scheduled,
      scheduledTime: draft.scheduledTime,
      platform: draft.platform,
      mediaCount: hosted.length,
    },
  })
}
