'use client'

import Script from 'next/script'
import { createElement } from 'react'
import { Bot, Phone, Mail } from 'lucide-react'
import crmConfig from '@/crm.config'

/* Olivia's ElevenLabs agent id. It is a public identifier (it is in the shop's
   page source too); what keeps the widget from being embedded elsewhere is the
   hostname allowlist on the agent, which includes this host. */
const OLIVIA_AGENT_ID = 'agent_3101kn8rkd7heb0rt2p5gtfqjf3a'

export default function OliviaPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <Bot className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        Olivia
      </h1>
      <p className="mb-6" style={{ color: 'var(--muted)' }}>
        The same gifting concierge who answers the shop and the phone line, here for the team.
      </p>

      <div className="card space-y-3 mb-6">
        <h2 className="font-semibold">Talking to her</h2>
        <p className="text-sm">
          Her widget sits at the bottom right of this page. Click it to start a voice
          conversation, or use the text box inside it. She can look a customer up, search the
          catalogue, list the gifting dates coming up, save an opportunity to the pipeline and
          book a call back, all against this CRM.
        </p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Everything she saves lands in Contacts, Pipeline and Tasks like any other entry, and
          each conversation is logged in Activities.
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Where else she is</h2>
        <p className="text-sm flex items-center gap-2">
          <Phone className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          {crmConfig.phone}, the Occasions Box line
        </p>
        <p className="text-sm flex items-center gap-2">
          <Mail className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          The chat bubble on occasionsbox.com
        </p>
      </div>

      <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="afterInteractive" />
      {createElement('elevenlabs-convai', { 'agent-id': OLIVIA_AGENT_ID })}
    </div>
  )
}
