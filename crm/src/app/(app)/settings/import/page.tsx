'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { withBasePath } from '@/lib/url'
import Link from 'next/link'
import { ArrowLeft, Upload, ArrowRight, CheckCircle, Loader2, FileSpreadsheet, AlertTriangle, Tag } from 'lucide-react'

interface ImportResult {
  imported: number
  updated: number
  tagged: number
  companiesCreated: number
  errors: number
  failures: Array<{ row: number; reason: string }>
}

type EntityType = 'contacts' | 'companies' | 'deals'

const FIELD_MAPS: Record<EntityType, { label: string; value: string; required?: boolean }[]> = {
  contacts: [
    { label: 'First Name', value: 'first_name', required: true },
    { label: 'Last Name', value: 'last_name' },
    { label: 'Email', value: 'email' },
    { label: 'Phone', value: 'phone' },
    // job_title, not title: the column is job_title, and mapping to the
    // wrong name used to fail every contact import outright.
    { label: 'Job Title', value: 'job_title' },
    // A company name here creates and links a real company row, which is
    // what the {{company}} merge field reads when a campaign goes out.
    { label: 'Company', value: 'company' },
    { label: 'Address', value: 'address' },
    { label: 'City', value: 'city' },
    { label: 'State', value: 'state' },
    { label: 'Zip', value: 'zip' },
    { label: 'Notes', value: 'notes' },
  ],
  companies: [
    { label: 'Name', value: 'name', required: true },
    { label: 'Domain', value: 'domain' },
    { label: 'Industry', value: 'industry' },
    { label: 'Phone', value: 'phone' },
    { label: 'Address', value: 'address' },
    { label: 'City', value: 'city' },
    { label: 'State', value: 'state' },
    { label: 'Zip', value: 'zip' },
    { label: 'Notes', value: 'notes' },
  ],
  deals: [
    { label: 'Title', value: 'title', required: true },
    { label: 'Amount', value: 'amount' },
    { label: 'Status', value: 'status' },
    { label: 'Close Date', value: 'close_date' },
    { label: 'Notes', value: 'notes' },
  ],
}

export default function ImportPage() {
  const [step, setStep] = useState(1)
  const [entityType, setEntityType] = useState<EntityType>('contacts')
  const [csvText, setCsvText] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  /** Applied to every contact as it lands, so the list can be selected later. */
  const [tagName, setTagName] = useState('')

  const supabase = createClient()

  useEffect(() => {
    // No org ID needed in standalone mode
  }, [])

  function parseCSV(text: string) {
    const lines = text.trim().split('\n')
    if (lines.length < 2) { setError('CSV must have headers and at least one data row'); return }

    const parseLine = (line: string) => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; continue }
        if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue }
        current += char
      }
      result.push(current.trim())
      return result
    }

    const h = parseLine(lines[0])
    const r = lines.slice(1).filter(l => l.trim()).map(parseLine)

    setHeaders(h)
    setRows(r)
    setError('')

    // Auto-map columns
    const autoMap: Record<string, string> = {}
    const fields = FIELD_MAPS[entityType]
    for (const header of h) {
      const normalized = header.toLowerCase().replace(/[^a-z]/g, '')
      const match = fields.find(f => {
        const fn = f.value.replace(/_/g, '')
        return normalized === fn || normalized.includes(fn) || fn.includes(normalized)
      })
      if (match) autoMap[header] = match.value
    }
    setMapping(autoMap)
    setStep(2)
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) readFile(file)
  }

  function readFile(file: File) {
    if (!file.name.endsWith('.csv')) { setError('Please upload a CSV file'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)
      parseCSV(text)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    setError('')
    setProgress(0)

    const fields = FIELD_MAPS[entityType]
    const requiredFields = fields.filter(f => f.required).map(f => f.value)
    const mappedRequired = requiredFields.every(rf => Object.values(mapping).includes(rf))

    if (!mappedRequired) {
      setError('Please map all required fields')
      setImporting(false)
      return
    }

    let imported = 0
    let updated = 0
    let tagged = 0
    let companiesCreated = 0
    let errors = 0
    const failures: Array<{ row: number; reason: string }> = []
    const batchSize = 50
    const totalRows = rows.length

    // The insert goes through the API, not straight from the browser: only
    // the server knows the organization_id every row needs, and contacts
    // also want company rows created and a tag applied as they land.
    for (let i = 0; i < totalRows; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const records = batch.map(row => {
        const record: Record<string, unknown> = {}
        for (const [csvHeader, dbField] of Object.entries(mapping)) {
          const idx = headers.indexOf(csvHeader)
          if (idx >= 0 && row[idx]) {
            record[dbField] = row[idx]
          }
        }
        if (entityType === 'deals') {
          record.status = record.status || 'open'
          if (record.amount) record.amount = Number(record.amount) || 0
        }
        return record
      })

      try {
        const res = await fetch(withBasePath('/api/v1/import'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityType,
            records,
            tagName: entityType === 'contacts' && tagName.trim() ? tagName.trim() : undefined,
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          errors += batch.length
          failures.push({ row: i + 1, reason: data?.error ?? `HTTP ${res.status}` })
        } else {
          imported += data.imported ?? 0
          updated += data.updated ?? 0
          tagged += data.tagged ?? 0
          companiesCreated += data.companiesCreated ?? 0
          errors += data.errors ?? 0
          if (Array.isArray(data.failures)) {
            for (const f of data.failures) failures.push({ row: i + f.row, reason: f.reason })
          }
        }
      } catch (err) {
        errors += batch.length
        failures.push({ row: i + 1, reason: err instanceof Error ? err.message : 'request failed' })
      }

      setProgress(Math.round(((i + batch.length) / totalRows) * 100))
    }

    setResult({ imported, updated, tagged, companiesCreated, errors, failures: failures.slice(0, 25) })
    setImporting(false)
    setStep(4)
  }

  return (
    <div className="max-w-3xl">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm mb-6 hover:underline" style={{ color: 'var(--muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Back to settings
      </Link>

      <h1 className="text-2xl font-bold mb-6">Import Data</h1>

      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-8">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              style={{
                background: step >= s ? 'var(--accent)' : 'var(--surface-2)',
                color: step >= s ? 'white' : 'var(--muted)',
              }}
            >
              {step > s ? <CheckCircle className="w-4 h-4" /> : s}
            </div>
            <span className="text-xs font-medium hidden sm:block" style={{ color: step >= s ? 'var(--text)' : 'var(--muted)' }}>
              {s === 1 ? 'Upload' : s === 2 ? 'Map Fields' : s === 3 ? 'Preview' : 'Import'}
            </span>
            {s < 4 && <div className="flex-1 h-px" style={{ background: step > s ? 'var(--accent)' : 'var(--border)' }} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm mb-4 flex items-center gap-2" style={{ background: 'rgba(225,112,85,0.1)', color: 'var(--danger)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="card">
          <div className="mb-4">
            <label>Import Type</label>
            <select value={entityType} onChange={e => setEntityType(e.target.value as EntityType)} className="w-full">
              <option value="contacts">Contacts</option>
              <option value="companies">Companies</option>
              <option value="deals">Deals</option>
            </select>
          </div>

          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${dragging ? 'border-[var(--accent)]' : ''}`}
            style={{ borderColor: dragging ? 'var(--accent)' : 'var(--border)' }}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => document.getElementById('csv-input')?.click()}
          >
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--surface-2)' }}>
                <Upload className="w-7 h-7" style={{ color: 'var(--accent)' }} />
              </div>
              <p className="font-semibold mb-1">Drop your CSV file here</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>or click to browse</p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Map fields */}
      {step === 2 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Map CSV Columns to CRM Fields</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
            Found {headers.length} columns and {rows.length} rows. Map each column to a field.
          </p>

          <div className="space-y-3">
            {headers.map(header => {
              const fields = FIELD_MAPS[entityType]
              return (
                <div key={header} className="flex items-center gap-4">
                  <div className="w-48 text-sm font-medium truncate flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
                    {header}
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
                  <select
                    value={mapping[header] ?? ''}
                    onChange={e => setMapping(prev => ({ ...prev, [header]: e.target.value }))}
                    className="flex-1"
                  >
                    <option value="">-- Skip --</option>
                    {fields.map(f => (
                      <option key={f.value} value={f.value}>
                        {f.label} {f.required ? '*' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setStep(1)} className="btn btn-secondary">Back</button>
            <button onClick={() => setStep(3)} className="btn btn-primary">
              Preview <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Preview (First 5 Rows)</h2>

          <div className="table-container mb-6">
            <table>
              <thead>
                <tr>
                  {Object.entries(mapping).filter(([, v]) => v).map(([csvCol, dbField]) => (
                    <th key={csvCol}>
                      <div>
                        <span className="block">{FIELD_MAPS[entityType].find(f => f.value === dbField)?.label}</span>
                        <span className="text-[10px] font-normal" style={{ color: 'var(--muted)' }}>{csvCol}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((row, ri) => (
                  <tr key={ri}>
                    {Object.entries(mapping).filter(([, v]) => v).map(([csvCol]) => {
                      const idx = headers.indexOf(csvCol)
                      return <td key={csvCol} style={{ color: 'var(--muted)' }}>{row[idx] ?? '-'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {entityType === 'contacts' && (
            <div className="mb-6 p-4 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <label className="flex items-center gap-2 mb-1.5 font-medium">
                <Tag className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Tag this list
              </label>
              <p className="text-xs mb-2.5" style={{ color: 'var(--muted)' }}>
                Every contact in this file gets this tag, which is how you select them all later to send one
                message. Name it for where the list came from, not for what you plan to say.
              </p>
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="Bergen County realtors, Sep 2026"
                maxLength={60}
                className="w-full"
              />
              {!tagName.trim() && (
                <p className="text-xs mt-2" style={{ color: 'var(--warning)' }}>
                  Without a tag these contacts land loose among everyone else and there is no way to pick
                  the list out again.
                </p>
              )}
            </div>
          )}

          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            Ready to import {rows.length} {entityType}
          </p>

          <div className="flex justify-end gap-3">
            <button onClick={() => setStep(2)} className="btn btn-secondary">Back</button>
            <button onClick={handleImport} disabled={importing} className="btn btn-primary">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Import {rows.length} Records
            </button>
          </div>

          {importing && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span style={{ color: 'var(--muted)' }}>Importing...</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%`, background: 'var(--accent)' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Result */}
      {step === 4 && result && (
        <div className="card text-center py-12">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 mx-auto" style={{ background: 'rgba(0,184,148,0.15)' }}>
            <CheckCircle className="w-8 h-8" style={{ color: 'var(--success)' }} />
          </div>
          <h2 className="text-xl font-bold mb-2">Import Complete</h2>
          <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>
            {result.imported} new {result.imported === 1 ? 'record' : 'records'}
            {result.updated > 0 && `, ${result.updated} already here and filled in`}
            {result.companiesCreated > 0 && `, ${result.companiesCreated} ${result.companiesCreated === 1 ? 'company' : 'companies'} created`}
          </p>
          {result.tagged > 0 && tagName.trim() && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {result.tagged} tagged <strong style={{ color: 'var(--text)' }}>{tagName.trim()}</strong>
            </p>
          )}
          {result.errors > 0 && (
            <div className="mt-4 mx-auto text-left max-w-lg p-3 rounded-lg" style={{ background: 'rgba(225,112,85,0.08)', border: '1px solid rgba(225,112,85,0.3)' }}>
              <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--danger)' }}>
                {result.errors} {result.errors === 1 ? 'row' : 'rows'} did not import
              </p>
              <ul className="text-xs space-y-0.5" style={{ color: 'var(--muted)' }}>
                {result.failures.map((f, i) => (
                  <li key={i}>Row {f.row}: {f.reason}</li>
                ))}
              </ul>
              {result.errors > result.failures.length && (
                <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                  and {result.errors - result.failures.length} more
                </p>
              )}
            </div>
          )}
          <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={() => { setStep(1); setResult(null); setCsvText(''); setHeaders([]); setRows([]) }} className="btn btn-secondary">
              Import More
            </button>
            <Link href={`/${entityType}`} className="btn btn-primary">
              View {entityType.charAt(0).toUpperCase() + entityType.slice(1)}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
