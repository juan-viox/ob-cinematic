'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Settings, Kanban, Upload, SlidersHorizontal, UsersRound, KeyRound } from 'lucide-react'
import crmConfig from '@/crm.config'
import { createClient } from '@/lib/supabase/client'

/* Sign-in is by password, and there was no way to change it from inside the
   CRM; the alternative was a reset email the project cannot send yet. Supabase
   updates the password of the signed-in user directly. */
function ChangePasswordCard() {
  const supabase = useMemo(() => createClient(), [])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    if (password.length < 10) {
      setMessage({ ok: false, text: 'Use at least 10 characters.' })
      return
    }
    if (password !== confirm) {
      setMessage({ ok: false, text: 'The two passwords do not match.' })
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      setMessage({ ok: false, text: error.message })
      return
    }
    setPassword('')
    setConfirm('')
    setMessage({ ok: true, text: 'Password updated. Use the new one next time you sign in.' })
  }

  return (
    <form onSubmit={submit} className="card space-y-4 mb-6">
      <h2 className="font-semibold flex items-center gap-2">
        <KeyRound className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        Change password
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className="w-full" minLength={10} required />
        </div>
        <div>
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className="w-full" minLength={10} required />
        </div>
      </div>
      {message && (
        <p className="text-sm" style={{ color: message.ok ? 'var(--success, #2e7d32)' : 'var(--danger)' }}>
          {message.text}
        </p>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving' : 'Update password'}
        </button>
      </div>
    </form>
  )
}

export default function SettingsPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="card space-y-4 mb-6">
        <h2 className="font-semibold flex items-center gap-2">
          <Settings className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          Organization
        </h2>

        <div>
          <label>Business Name</label>
          <input value={crmConfig.name} readOnly className="w-full" />
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Edit src/crm.config.ts to change business settings
          </p>
        </div>
      </div>

      <ChangePasswordCard />

      <div className="space-y-3">
        <Link href="/settings/pipeline" className="card flex items-center justify-between hover:border-[var(--accent)] transition-colors">
          <div className="flex items-center gap-3">
            <Kanban className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <p className="font-semibold">Pipeline Stages</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Manage deal stages, colors, and order</p>
            </div>
          </div>
          <span style={{ color: 'var(--muted)' }}>&rarr;</span>
        </Link>

        <Link href="/settings/team" className="card flex items-center justify-between hover:border-[var(--accent)] transition-colors">
          <div className="flex items-center gap-3">
            <UsersRound className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <p className="font-semibold">Team Management</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Invite users, manage roles and permissions</p>
            </div>
          </div>
          <span style={{ color: 'var(--muted)' }}>&rarr;</span>
        </Link>

        <Link href="/settings/import" className="card flex items-center justify-between hover:border-[var(--accent)] transition-colors">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <p className="font-semibold">Import Data</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Import contacts, companies, or deals from CSV</p>
            </div>
          </div>
          <span style={{ color: 'var(--muted)' }}>&rarr;</span>
        </Link>

        <Link href="/settings/custom-fields" className="card flex items-center justify-between hover:border-[var(--accent)] transition-colors">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <div>
              <p className="font-semibold">Custom Fields</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Add custom fields to contacts, companies, and deals</p>
            </div>
          </div>
          <span style={{ color: 'var(--muted)' }}>&rarr;</span>
        </Link>
      </div>
    </div>
  )
}
