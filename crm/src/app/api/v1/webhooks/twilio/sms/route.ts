import { NextResponse } from 'next/server'
import { getIngestClient, getOrgId } from '@/lib/ingest'
import { HELP_WORDS, START_WORDS, STOP_WORDS, getTwilioConfig, toE164, verifyTwilioSignature } from '@/lib/sms'
import crmConfig from '@/crm.config'

/**
 * POST /api/v1/webhooks/twilio/sms
 *
 * What a customer texts back. Point Twilio's "A message comes in" webhook for
 * the sending number at this URL.
 *
 * STOP means stop, immediately and permanently, until the same number says
 * START. Carriers require it, the law requires it, and a customer who has to
 * ask twice is a customer we have lost. The refusal is recorded against the
 * number and against the contact, so it holds even for a number we have not
 * met before.
 *
 * Twilio signs every delivery; an unsigned or wrongly signed request is
 * refused, because otherwise a stranger could opt our customers back in.
 */
function twiml(message?: string): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message.replace(/[<>&]/g, '')}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(request: Request) {
  const config = getTwilioConfig()
  if (!config) {
    console.error('[webhook:twilio] Twilio is not configured; refusing the delivery')
    return NextResponse.json({ error: 'Twilio is not configured' }, { status: 503 })
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'Unable to read body' }, { status: 400 })
  }

  const form = new URLSearchParams(raw)
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = v

  /* Twilio signs the exact URL it was configured with, so the check is only
     as good as our idea of that URL. Behind a proxy request.url can carry the
     internal host, and a mismatch would refuse every real delivery, which
     would mean silently ignoring STOP. So try the forwarded host as well, and
     accept only if one of them verifies: both candidates still have to carry
     a correct HMAC, so this widens what we recognise, not what we trust. */
  const signature = request.headers.get('x-twilio-signature')
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  const candidates = [request.url]
  if (forwardedHost) {
    try {
      candidates.push(`${forwardedProto}://${forwardedHost}${new URL(request.url).pathname}`)
    } catch {
      // an unparseable request URL leaves the one candidate
    }
  }
  const verified = candidates.some((url) =>
    verifyTwilioSignature(url, params, signature, config.authToken)
  )
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const from = toE164(params.From)
  const text = (params.Body ?? '').trim().toLowerCase()
  if (!from) return twiml()

  const supabase = getIngestClient()
  const orgId = await getOrgId(supabase)

  if (STOP_WORDS.includes(text)) {
    await supabase
      .from('sms_opt_outs')
      .upsert({ organization_id: orgId, phone: from, reason: `replied ${text}` }, { onConflict: 'organization_id,phone' })
    await supabase
      .from('contacts')
      .update({ sms_opt_out: true, sms_opt_out_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('phone', from)
    // Twilio's own STOP handling already sends the confirmation carriers
    // require, so saying it again would text someone who just asked us not to.
    return twiml()
  }

  if (START_WORDS.includes(text)) {
    await supabase.from('sms_opt_outs').delete().eq('organization_id', orgId).eq('phone', from)
    await supabase
      .from('contacts')
      .update({ sms_opt_out: false, sms_opt_out_at: null })
      .eq('organization_id', orgId)
      .eq('phone', from)
    return twiml(`You are subscribed to ${crmConfig.name} order updates again. Reply STOP to stop.`)
  }

  if (HELP_WORDS.includes(text)) {
    return twiml(`${crmConfig.name}: order updates. Call ${crmConfig.phone} or email ${crmConfig.email}. Reply STOP to stop.`)
  }

  // Anything else is a real person replying about their gift. File it so
  // somebody answers, and say nothing automatic back.
  await supabase.from('activities').insert({
    organization_id: orgId,
    type: 'sms',
    title: `Text from ${from}`.slice(0, 200),
    description: (params.Body ?? '').slice(0, 2000),
    status: 'pending',
    metadata: { from, direction: 'inbound', message_sid: params.MessageSid ?? null },
  })
  return twiml()
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
