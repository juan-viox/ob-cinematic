import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The public opt-out. No session: the whole point is that it works from an
 * inbox, months later, for somebody who has never seen the CRM.
 *
 * GET renders a confirmation with a button; POST performs the opt-out.
 * A GET that mutated would be a bug rather than a convenience: corporate
 * mail scanners and link-preview crawlers fetch every URL in a message
 * before the recipient ever sees it, and a one-click GET would quietly
 * unsubscribe people who never touched the link. RFC 8058's
 * List-Unsubscribe-Post header, set on the send, is what lets Gmail's own
 * unsubscribe button reach the POST directly, so the button below is only
 * for people who clicked the link in the body.
 */

const STYLE =
  `body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
  `background:#faf7f1;color:#211c14;font-family:Georgia,'Times New Roman',serif;padding:24px;}` +
  `.card{max-width:32rem;background:#fff;border:1px solid #dcd2c0;border-radius:12px;padding:32px;text-align:center;}` +
  `h1{font-size:24px;margin:0 0 12px;font-weight:600;}` +
  `p{font-size:15px;line-height:1.6;color:#6e6452;margin:0 0 20px;}` +
  `button{font:inherit;font-size:15px;padding:11px 24px;border-radius:8px;border:1px solid #8a6a0f;` +
  `background:#8a6a0f;color:#fff;cursor:pointer;}` +
  `button:hover{background:#6f5409;}` +
  `.small{font-size:13px;color:#8a7f6c;margin:18px 0 0;}`

function page(title: string, bodyHtml: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex">` +
      `<title>${title}</title><style>${STYLE}</style></head>` +
      `<body><div class="card">${bodyHtml}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )
}

/** A token is 36 hex characters; anything else is not worth a database round trip. */
function cleanToken(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim()
  return /^[0-9a-f]{20,80}$/i.test(t) ? t : null
}

export async function GET(request: Request) {
  const token = cleanToken(new URL(request.url).searchParams.get('t'))
  if (!token) {
    return page('Unsubscribe', '<h1>That link is not valid</h1><p>Write to Hello@occasionsbox.com and we will take you off by hand.</p>', 400)
  }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('contacts')
    .select('email, email_opt_out')
    .eq('unsubscribe_token', token)
    .maybeSingle()

  // A wrong token gets the same page as a right one. Telling a stranger
  // whether a token is real turns this endpoint into an address checker.
  if (data?.email_opt_out) {
    return page('Unsubscribe', '<h1>You are already unsubscribed</h1><p>We will not write again. Nothing more to do.</p>')
  }

  const who = data?.email ? `<p>We will stop writing to <strong>${data.email.replace(/</g, '&lt;')}</strong>.</p>` : ''
  return page(
    'Unsubscribe',
    `<h1>Unsubscribe from Occasions Box</h1>${who}` +
      `<form method="POST"><input type="hidden" name="t" value="${token}"/>` +
      `<button type="submit">Yes, unsubscribe me</button></form>` +
      `<p class="small">This only stops marketing email. If you have an order with us, we will still send you its confirmation and tracking.</p>`
  )
}

export async function POST(request: Request) {
  let token = cleanToken(new URL(request.url).searchParams.get('t'))
  if (!token) {
    // Both the form button and Gmail's RFC 8058 one-click post a body.
    const raw = await request.text().catch(() => '')
    token = cleanToken(new URLSearchParams(raw).get('t'))
  }
  if (!token) {
    return page('Unsubscribe', '<h1>That link is not valid</h1><p>Write to Hello@occasionsbox.com and we will take you off by hand.</p>', 400)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('contacts')
    .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .select('id, organization_id, email')
    .maybeSingle()

  if (error) {
    console.error('[unsubscribe]', error.message)
    return page('Unsubscribe', '<h1>Something went wrong</h1><p>Write to Hello@occasionsbox.com and we will take you off by hand.</p>', 500)
  }

  // Recorded on the timeline so nobody wonders later why this contact
  // stopped receiving campaigns, and so the opt-out is auditable.
  if (data?.id) {
    await supabase.from('activities').insert({
      organization_id: data.organization_id,
      contact_id: data.id,
      type: 'note',
      title: 'Unsubscribed from marketing email',
      description: 'Used the unsubscribe link in a campaign. Order confirmations and tracking are unaffected.',
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: { channel: 'email', via: 'unsubscribe_link' },
    })
  }

  // Same page whether or not the token matched, for the reason above.
  return page('Unsubscribe', '<h1>Done</h1><p>You are unsubscribed. We will not write again.</p>')
}
