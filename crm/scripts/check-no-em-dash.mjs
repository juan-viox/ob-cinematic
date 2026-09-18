#!/usr/bin/env node
/*
 * The build refuses an em dash.
 *
 * Sarah's rule outlives any one cleanup: no em dash anywhere, ever. The site
 * build has enforced that for site/ since tools/build-pages.mjs learned to,
 * but nothing ever looked at the CRM, so "not configured yet — add the
 * Supabase environment variables" shipped and became the first thing she saw
 * on a deployment that had not been given its keys yet.
 *
 * A rule that depends on remembering is a rule that breaks the next time copy
 * is written, so the build holds this one. Runs as `prebuild`, which npm fires
 * before `npm run build`, which is what Vercel runs.
 *
 * En dashes pass. They are ranges, and they are correct. The empty-cell
 * placeholders in the tables use one deliberately.
 *
 *   node scripts/check-no-em-dash.mjs      # from crm/
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const EM_DASH = '—'
const here = path.dirname(fileURLToPath(import.meta.url))
const ROOTS = ['src'].map((d) => path.join(here, '..', d))
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.md', '.html'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build'])

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTENSIONS.has(path.extname(entry))) out.push(full)
  }
  return out
}

const offences = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Catch the literal character and the two escapes it hides behind.
      const written = line.includes(EM_DASH)
      const escaped = /&mdash;|&#8212;|\\u2014/i.test(line)
      if (!written && !escaped) return
      const column = written ? line.indexOf(EM_DASH) : 0
      offences.push({
        file: path.relative(path.join(here, '..'), file),
        line: i + 1,
        column: column + 1,
        text: line.trim().slice(0, 160),
      })
    })
  }
}

if (offences.length === 0) {
  console.log('no em dash in crm/src')
  process.exit(0)
}

console.error(`\nThe build refuses an em dash. ${offences.length} found:\n`)
for (const o of offences) {
  console.error(`  ${o.file}:${o.line}:${o.column}`)
  console.error(`    ${o.text}\n`)
}
console.error('Give each sentence the mark it actually wants, rather than one blanket')
console.error('substitution. A list after a complete clause takes a colon. Two halves')
console.error('that each stand alone take a semicolon. An appositive takes a comma.')
console.error('An en dash is a different mark and passes; it is a range.\n')
process.exit(1)
