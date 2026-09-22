'use client'

import { useEffect, useRef, useState } from 'react'
import { Tag as TagIcon, X, Plus, Loader2 } from 'lucide-react'
import { withBasePath } from '@/lib/url'

export interface TagChip { id: string; name: string; color: string | null; count?: number }

/**
 * The tags on one record, and the means to change them.
 *
 * Suggestions come from tags the organisation already uses, because the
 * value of a tag is entirely in other records carrying the same one.
 * "Real Estate" and "real estate" and "Realestate" are three useless tags,
 * so the existing list is offered first and free text is the fallback.
 */
export default function TagEditor({
  entityType,
  entityId,
  initial,
}: {
  entityType: 'contact' | 'company' | 'deal'
  entityId: string
  initial: TagChip[]
}) {
  const [tags, setTags] = useState<TagChip[]>(initial)
  const [all, setAll] = useState<TagChip[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!adding) return
    inputRef.current?.focus()
    if (all.length) return
    fetch(withBasePath('/api/v1/tags'))
      .then((r) => r.json())
      .then((d) => setAll(d.tags ?? []))
      .catch(() => {})
  }, [adding, all.length])

  async function apply(name: string, action: 'add' | 'remove') {
    const clean = name.trim()
    if (!clean) return
    setBusy(clean)
    setError('')
    try {
      const res = await fetch(withBasePath('/api/v1/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean, entityType, entityId, action }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Could not save that tag')
      } else if (action === 'add') {
        setTags((prev) => (prev.some((t) => t.name === clean) ? prev : [...prev, data.tag]))
        setDraft('')
        setAdding(false)
      } else {
        setTags((prev) => prev.filter((t) => t.name !== clean))
      }
    } catch {
      setError('Could not save that tag')
    }
    setBusy(null)
  }

  const suggestions = all
    .filter((t) => !tags.some((x) => x.name === t.name))
    .filter((t) => t.name.toLowerCase().includes(draft.trim().toLowerCase()))
    .slice(0, 6)

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"
          style={{ color: 'var(--muted)' }}>
        <TagIcon className="w-3.5 h-3.5" /> Tags
      </h4>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span key={t.id ?? t.name}
                className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs"
                style={{ background: 'var(--surface-2)', border: `1px solid ${t.color ?? 'var(--border)'}40`, color: 'var(--text)' }}>
            {t.name}
            <button onClick={() => apply(t.name, 'remove')} disabled={busy === t.name}
                    title={`Remove ${t.name}`}
                    className="p-0.5 rounded-full hover:bg-[var(--surface)] transition-colors">
              {busy === t.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            </button>
          </span>
        ))}

        {!adding && (
          <button onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-colors"
                  style={{ border: '1px dashed var(--border)', color: 'var(--muted)' }}>
            <Plus className="w-3 h-3" /> Tag
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void apply(draft, 'add') }
              if (e.key === 'Escape') { setAdding(false); setDraft('') }
            }}
            onBlur={() => { if (!draft.trim()) setAdding(false) }}
            placeholder="Type a tag, Enter to add"
            maxLength={60}
            className="w-full text-sm"
          />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map((t) => (
                <button key={t.id} onMouseDown={(e) => e.preventDefault()}
                        onClick={() => apply(t.name, 'add')}
                        className="px-2.5 py-1 rounded-full text-xs transition-colors"
                        style={{ background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                  {t.name} <span style={{ opacity: 0.6 }}>{t.count ?? ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
