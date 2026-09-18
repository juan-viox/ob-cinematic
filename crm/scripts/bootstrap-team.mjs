#!/usr/bin/env node
/*
 * Creates the OccasionsBox team: the organisation, the pipeline stages and a
 * profile for each person, then emails them an invite link so they set their
 * own password. Nobody's password is ever typed here or stored in the repo.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/bootstrap-team.mjs sarah@occasionsbox.com:owner:"Sarah De Jesus" \
 *                                     kari@occasionsbox.com:admin:"Kari Aragon"
 *
 * Or put the values in crm/.env.local and run it with no arguments to use the
 * default team below.
 *
 * Re-running is safe: an existing account keeps its password and its role is
 * left alone unless --update-roles is passed.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CRM = path.resolve(here, '..')

/** The people who run Occasions Box. One owner; everyone else is an admin. */
const DEFAULT_TEAM = [
  { email: 'sarah@occasionsbox.com', role: 'owner', name: 'Sarah De Jesus' },
  { email: 'kari@occasionsbox.com', role: 'admin', name: 'Kari Aragon' },
]

/** Reads crm/.env.local so the script works with no exported variables. */
function loadEnvLocal() {
  try {
    const text = readFileSync(path.join(CRM, '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!m) continue
      const value = m[2].replace(/^['"]|['"]$/g, '')
      if (!process.env[m[1]] && value) process.env[m[1]] = value
    }
  } catch {
    // no .env.local: rely on the environment
  }
}

function parsePerson(arg) {
  // email:role:Full Name — the name may contain colons? No: split on the first two.
  const first = arg.indexOf(':')
  if (first === -1) return { email: arg.trim(), role: 'admin', name: '' }
  const second = arg.indexOf(':', first + 1)
  const email = arg.slice(0, first).trim()
  const role = (second === -1 ? arg.slice(first + 1) : arg.slice(first + 1, second)).trim() || 'admin'
  const name = second === -1 ? '' : arg.slice(second + 1).trim()
  return { email, role, name }
}

async function main() {
  loadEnvLocal()

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY, or fill in crm/.env.local.')
    process.exit(1)
  }

  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const updateRoles = process.argv.includes('--update-roles')
  const team = args.length ? args.map(parsePerson) : DEFAULT_TEAM

  const bad = team.filter((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email) || !['owner', 'admin', 'member'].includes(p.role))
  if (bad.length) {
    console.error('Each person is email:role:Name, role being owner, admin or member. Bad:', bad.map((b) => b.email || '(blank)').join(', '))
    process.exit(1)
  }
  if (team.filter((p) => p.role === 'owner').length > 1) {
    console.error('Only one person can be the owner; the database enforces it.')
    process.exit(1)
  }

  // crm.config.ts is TypeScript, which node cannot import; read the three
  // values we need out of it so the script and the app cannot disagree.
  const config = readFileSync(path.join(CRM, 'src/crm.config.ts'), 'utf8')
  const slug = /slug:\s*'([^']+)'/.exec(config)?.[1] ?? 'occasionsbox'
  const name = /name:\s*'([^']+)'/.exec(config)?.[1] ?? 'OccasionsBox'
  const stages = [...config.matchAll(
    /\{\s*name:\s*'([^']+)',\s*color:\s*'([^']+)',\s*sort_order:\s*(\d+)(?:,\s*is_won:\s*(true|false))?(?:,\s*is_lost:\s*(true|false))?\s*\}/g
  )].map((m) => ({
    name: m[1], color: m[2], sort_order: Number(m[3]),
    is_won: m[4] === 'true', is_lost: m[5] === 'true',
  }))

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || `${url.replace(/\/$/, '')}`).replace(/\/$/, '')
  const redirectTo = appUrl.endsWith('/admin') ? `${appUrl}/auth/callback` : `${appUrl}/admin/auth/callback`

  // 1. Organisation
  let orgId
  const { data: existingOrg, error: orgReadError } = await admin.from('organizations').select('id').eq('slug', slug).maybeSingle()
  if (orgReadError) { console.error('Could not read organizations:', orgReadError.message); process.exit(1) }
  if (existingOrg) {
    orgId = existingOrg.id
    console.log(`Organisation ${slug} already exists.`)
  } else {
    const { data: created, error } = await admin.from('organizations').insert({ name, slug }).select('id').single()
    if (error) { console.error('Could not create the organisation:', error.message); process.exit(1) }
    orgId = created.id
    console.log(`Created organisation ${name} (${slug}).`)
  }

  // 2. Pipeline stages, only if it has none
  const { data: existingStages } = await admin.from('deal_stages').select('id').eq('organization_id', orgId).limit(1)
  if ((!existingStages || existingStages.length === 0) && stages.length) {
    const { error } = await admin.from('deal_stages').insert(
      stages.map((s) => ({
        organization_id: orgId, name: s.name, color: s.color, sort_order: s.sort_order,
        is_won: s.is_won ?? false, is_lost: s.is_lost ?? false,
      }))
    )
    if (error) console.error('Could not seed the pipeline stages:', error.message)
    else console.log(`Seeded ${stages.length} pipeline stages.`)
  }

  // 3. People
  for (const person of team) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (listError) { console.error(`Could not list users: ${listError.message}`); process.exit(1) }
    let user = list.users.find((u) => (u.email ?? '').toLowerCase() === person.email.toLowerCase())

    if (!user) {
      const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(person.email, {
        redirectTo,
        data: { full_name: person.name || undefined },
      })
      if (error) {
        console.error(`  ${person.email}: invite failed — ${error.message}`)
        continue
      }
      user = invited.user
      console.log(`  ${person.email}: invited (${person.role}). They set their own password from the email.`)
    } else {
      console.log(`  ${person.email}: account already exists.`)
    }
    if (!user) continue

    const { data: profile } = await admin.from('profiles').select('id, role').eq('id', user.id).maybeSingle()
    if (!profile) {
      const { error } = await admin.from('profiles').insert({
        id: user.id, organization_id: orgId, full_name: person.name || null, role: person.role,
      })
      if (error) console.error(`  ${person.email}: could not create the profile — ${error.message}`)
      else console.log(`    profile created as ${person.role}.`)
    } else if (updateRoles && profile.role !== person.role) {
      const { error } = await admin.from('profiles').update({ role: person.role, full_name: person.name || null }).eq('id', user.id)
      if (error) console.error(`  ${person.email}: could not change the role — ${error.message}`)
      else console.log(`    role changed ${profile.role} → ${person.role}.`)
    } else {
      console.log(`    profile already there (${profile.role}).`)
    }
  }

  console.log('\nDone. Anyone who did not get an email can use "Forgot password" on the login page.')
  console.log('Turn off public sign-ups in Supabase once everyone is in: Authentication → Providers → Email → Enable Sign Ups off.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
