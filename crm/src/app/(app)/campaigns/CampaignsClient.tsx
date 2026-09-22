'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle, Loader2, Mail, Send, Tag as TagIcon, Users, Eye, Ban,
} from 'lucide-react'
import { withBasePath } from '@/lib/url'
import { missingMergeFields, renderMerge, TEST_TAG } from '@/lib/campaign'

interface TagRow { id: string; name: string; color: string | null; count: number }
interface TemplateRow { id: string; name: string; subject: string | null; body: string | null }

interface Recipient {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  job_title: string | null
  company: string | null
  skip: 'no_email' | 'opted_out' | null
}

interface Audience {
  total: number
  sendable: number
  optedOut: number
  noEmail: number
  senderReady: boolean
  senderHelp: string | null
  from: string | null
  replyTo: string | null
  testCount: number
  testEmails: string[]
  recipients: Recipient[]
}

interface Progress { processed: number; total: number; sent: number; skipped: number; failed: number }

const SKIP_LABEL: Record<NonNullable<Recipient['skip']>, string> = {
  no_email: 'no email address',
  opted_out: 'asked us to stop',
}

/** The shape renderMerge wants, built from what the audience endpoint returns. */
function asMergeContact(r: Recipient, custom: Record<string, string> = {}) {
  return {
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    job_title: r.job_title,
    company: r.company ? { name: r.company } : null,
    custom,
  }
}

export default function CampaignsClient({
  tags,
  templates,
}: {
  tags: TagRow[]
  templates: TemplateRow[]
}) {
  const [tagId, setTagId] = useState('')
  const [audience, setAudience] = useState<Audience | null>(null)
  const [loadingAudience, setLoadingAudience] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Progress | null>(null)
  /** A test must have gone out, and been looked at, before the real send unlocks. */
  const [lastWasTest, setLastWasTest] = useState(false)
  const [testPassed, setTestPassed] = useState(false)

  const usableTags = useMemo(() => tags.filter((t) => t.count > 0), [tags])

  const loadAudience = useCallback(async (id: string) => {
    if (!id) { setAudience(null); return }
    setLoadingAudience(true)
    setError('')
    try {
      const res = await fetch(withBasePath(`/api/v1/email/campaign?tagId=${encodeURIComponent(id)}`))
      const data = await res.json()
      if (!res.ok) { setError(data?.error ?? 'Could not load that audience'); setAudience(null) }
      else { setAudience(data); setPreviewIndex(0) }
    } catch {
      setError('Could not load that audience')
    }
    setLoadingAudience(false)
  }, [])

  useEffect(() => { void loadAudience(tagId) }, [tagId, loadAudience])

  const sendable = audience?.recipients.filter((r) => r.skip === null) ?? []
  const previewOf = sendable[previewIndex] ?? null

  // The preview cannot see custom fields (the audience endpoint returns only
  // what it needs to decide who is skipped), so per-contact placeholders show
  // as unresolved here. Flagged rather than hidden: better to explain it than
  // to let someone think their opening line is missing.
  const unresolved = previewOf ? missingMergeFields(subject + '\n' + body, asMergeContact(previewOf)) : []
  const PER_CONTACT = new Set(['personalized opening', 'relevant gifting use case', 'personalized_opening', 'gifting_use_case'])
  const perContact = unresolved.filter((k) => PER_CONTACT.has(k.toLowerCase()))
  const genuinelyMissing = unresolved.filter((k) => !PER_CONTACT.has(k.toLowerCase()))

  /**
   * Any change to who or what is being sent re-locks the real send.
   *
   * An approval is of the message that was tested, not of the button. Edit a
   * line after the test and the thing that was checked no longer exists.
   */
  function editDraft(fn: () => void) {
    fn()
    setTestPassed(false)
  }

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id)
    if (!t) return
    editDraft(() => {
      setSubject(t.subject ?? '')
      setBody(t.body ?? '')
    })
  }

  async function send(testOnly: boolean) {
    if (!audience || !tagId) return
    setSending(true); setError(''); setDone(null)
    setLastWasTest(testOnly)
    const totals: Progress = {
      processed: 0,
      total: testOnly ? audience.testCount : audience.total,
      sent: 0, skipped: 0, failed: 0,
    }
    setProgress({ ...totals })

    let offset: number | null = 0
    while (offset !== null) {
      let data: {
        error?: string; total?: number; processed?: number; nextOffset?: number | null
        sent?: number; skipped?: number; failures?: unknown[]
      }
      try {
        const res = await fetch(withBasePath('/api/v1/email/campaign'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagId, subject, body, offset, testOnly }),
        })
        data = await res.json()
        if (!res.ok) { setError(data?.error ?? `Send failed (HTTP ${res.status})`); break }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Send failed')
        break
      }
      totals.sent += data.sent ?? 0
      totals.skipped += data.skipped ?? 0
      totals.failed += Array.isArray(data.failures) ? data.failures.length : 0
      totals.processed = data.processed ?? totals.processed
      totals.total = data.total ?? totals.total
      setProgress({ ...totals })
      offset = data.nextOffset ?? null
    }

    setSending(false)
    setDone({ ...totals })
  }

  const blocked = audience ? !audience.senderReady : false
  const ready = !!audience && subject.trim() !== '' && body.trim() !== ''
    && !blocked && genuinelyMissing.length === 0 && !sending
  const canTest = ready && (audience?.testCount ?? 0) > 0
  // The real send stays locked until a test has gone out and been confirmed
  // by eye. Twenty-four strangers is not the place to discover a broken merge.
  const canSend = ready && sendable.length > 0 && testPassed

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          One message to everyone carrying a tag, with each person&apos;s name and company merged in.
        </p>
      </div>

      {error && (
        <div className="card mb-6 flex items-start gap-3" style={{ borderColor: 'rgba(225,112,85,0.4)', background: 'rgba(225,112,85,0.07)' }}>
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {blocked && audience?.senderHelp && (
        <div className="card mb-6 flex items-start gap-3" style={{ borderColor: 'rgba(225,112,85,0.4)', background: 'rgba(225,112,85,0.07)' }}>
          <Ban className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <div className="text-sm">
            <p className="font-semibold mb-1">Sending is switched off until the campaign address exists</p>
            <p style={{ color: 'var(--muted)' }}>{audience.senderHelp}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <label className="flex items-center gap-2 mb-2 font-medium">
              <TagIcon className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Who is this going to
            </label>
            <select value={tagId} onChange={(e) => editDraft(() => setTagId(e.target.value))} className="w-full">
              <option value="">Pick a tag</option>
              {usableTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
              ))}
            </select>
            {usableTags.length === 0 && (
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                No tag has any contacts on it yet. Import a list under Settings, Import and give it a tag.
              </p>
            )}
          </div>

          <div className="card space-y-4">
            {templates.length > 0 && (
              <div>
                <label>Start from a template</label>
                <select defaultValue="" onChange={(e) => applyTemplate(e.target.value)} className="w-full">
                  <option value="">Write it from scratch</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label>Subject</label>
              <input value={subject} onChange={(e) => editDraft(() => setSubject(e.target.value))} className="w-full"
                     placeholder="A local gifting resource for {{Company Name}}" />
            </div>
            <div>
              <label>Message</label>
              <textarea rows={14} value={body} onChange={(e) => editDraft(() => setBody(e.target.value))} className="w-full"
                        placeholder={'Hi {{First Name}},\n\n{{Personalized Opening}}\n\n...'} />
              <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                Merge fields: <code>{'{{First Name}}'}</code> <code>{'{{Last Name}}'}</code>{' '}
                <code>{'{{Company Name}}'}</code> <code>{'{{Job Title}}'}</code>{' '}
                <code>{'{{Personalized Opening}}'}</code> <code>{'{{Relevant Gifting Use Case}}'}</code>.
                Capitals and spaces do not matter. An unsubscribe link is added automatically.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 className="font-medium flex items-center gap-2 mb-3">
              <Users className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Audience
            </h3>
            {loadingAudience ? (
              <p className="text-sm flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                <Loader2 className="w-4 h-4 animate-spin" /> Loading
              </p>
            ) : audience ? (
              <>
                <p className="text-3xl font-bold tabular-nums" style={{ color: 'var(--accent-light)' }}>
                  {audience.sendable}
                </p>
                <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
                  will receive this, of {audience.total} tagged
                </p>
                {(audience.optedOut > 0 || audience.noEmail > 0) && (
                  <ul className="text-xs space-y-1" style={{ color: 'var(--muted)' }}>
                    {audience.optedOut > 0 && <li>{audience.optedOut} asked us to stop, skipped</li>}
                    {audience.noEmail > 0 && <li>{audience.noEmail} have no email address, skipped</li>}
                  </ul>
                )}
                {(audience.from || audience.replyTo) && (
                  <div className="mt-3 pt-3 text-xs space-y-1" style={{ borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
                    {audience.from && <p>From <span style={{ color: 'var(--text)' }}>{audience.from}</span></p>}
                    {/* The sending subdomain has no mailbox, so where a reply
                        lands is the thing worth checking before pressing send. */}
                    {audience.replyTo && <p>Replies go to <span style={{ color: 'var(--text)' }}>{audience.replyTo}</span></p>}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Pick a tag to see who is on it.</p>
            )}
          </div>

          {previewOf && (subject || body) && (
            <div className="card">
              <h3 className="font-medium flex items-center gap-2 mb-1">
                <Eye className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Preview
              </h3>
              <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: 'var(--muted)' }}>
                <button onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                        disabled={previewIndex === 0} className="btn btn-ghost btn-sm">Prev</button>
                <span>{previewIndex + 1} of {sendable.length}</span>
                <button onClick={() => setPreviewIndex((i) => Math.min(sendable.length - 1, i + 1))}
                        disabled={previewIndex >= sendable.length - 1} className="btn btn-ghost btn-sm">Next</button>
              </div>
              <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>To: {previewOf.email}</p>
              <p className="text-sm font-semibold mb-2">{renderMerge(subject, asMergeContact(previewOf))}</p>
              <pre className="text-xs whitespace-pre-wrap font-sans p-3 rounded-lg"
                   style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
                {renderMerge(body, asMergeContact(previewOf))}
              </pre>

              {perContact.length > 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                  {perContact.join(', ')} {perContact.length === 1 ? 'is' : 'are'} stored per contact and will
                  fill in at send time. The preview cannot read them.
                </p>
              )}
              {genuinelyMissing.length > 0 && (
                <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>
                  {genuinelyMissing.join(', ')} will not resolve for this contact. Sending is blocked until
                  that is fixed or the placeholder is removed.
                </p>
              )}
            </div>
          )}

          <div className="card">
            {done ? (
              <div className="text-center py-2">
                <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--success)' }} />
                <p className="font-semibold">
                  {lastWasTest ? `Test sent to ${done.sent}` : `${done.sent} sent`}
                </p>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {done.skipped > 0 && `${done.skipped} skipped. `}
                  {done.failed > 0 && `${done.failed} failed.`}
                </p>

                {/* After a test, the next step is not another button press: it
                    is going and reading the email. The real send stays locked
                    until somebody says out loud that they did. */}
                {lastWasTest && done.sent > 0 ? (
                  <div className="mt-4 pt-4 text-left" style={{ borderTop: '1px solid var(--border)' }}>
                    <p className="text-sm mb-2">Go and read it before anything else goes out.</p>
                    <ul className="text-xs space-y-1 mb-3" style={{ color: 'var(--muted)' }}>
                      {audience?.testEmails.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                    <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
                      Check the name and company read correctly, that the reply address is right,
                      and that the unsubscribe link at the bottom works.
                    </p>
                    <button
                      onClick={() => { setTestPassed(true); setDone(null); setProgress(null) }}
                      className="btn btn-secondary btn-sm w-full"
                    >
                      It looks right, unlock the real send
                    </button>
                    <button
                      onClick={() => { setDone(null); setProgress(null) }}
                      className="btn btn-ghost btn-sm w-full mt-2"
                    >
                      Something is wrong, let me edit it
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setDone(null); setProgress(null) }} className="btn btn-secondary btn-sm mt-3">
                    Send another
                  </button>
                )}
              </div>
            ) : (
              <>
                {sending && progress && (
                  <div className="mb-3">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full transition-all"
                           style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%`, background: 'var(--accent)' }} />
                    </div>
                    <p className="text-xs mt-1.5 tabular-nums" style={{ color: 'var(--muted)' }}>
                      {progress.processed} of {progress.total} · {progress.sent} sent
                    </p>
                  </div>
                )}
                <button onClick={() => void send(true)} disabled={!canTest}
                        className={testPassed ? 'btn btn-secondary w-full' : 'btn btn-primary w-full'}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {sending ? 'Sending' : `Send a test to ${audience?.testCount ?? 0}`}
                </button>
                {audience && audience.testCount > 0 && (
                  <p className="text-xs mt-1.5 text-center" style={{ color: 'var(--muted)' }}>
                    {audience.testEmails.join(', ')}
                  </p>
                )}

                <button onClick={() => void send(false)} disabled={!canSend}
                        className="btn btn-primary w-full mt-4"
                        style={testPassed ? undefined : { opacity: 0.55 }}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Sending' : `Send to all ${sendable.length}`}
                </button>
                <p className="text-xs mt-2 text-center" style={{ color: 'var(--muted)' }}>
                  {audience && audience.testCount === 0
                    ? `Nobody on this tag also carries the "${TEST_TAG}" tag, so there is no inbox to test with.`
                    : testPassed
                      ? 'Test checked. This goes to everyone on the tag.'
                      : 'Send the test first and read it. This unlocks once you confirm it looks right.'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
