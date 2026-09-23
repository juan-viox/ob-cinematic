#!/usr/bin/env node
/**
 * Point the shop's PayPal checkout at a different PayPal app.
 *
 * Why this exists: the CRM verifies a paid order by asking PayPal about it,
 * and PayPal only answers for the merchant that owns the order. So the app
 * whose client id the shop checks out with, and the app whose client id and
 * secret the CRM verifies with, have to be the same app. If they are not,
 * every real payment lands as "Unverified" and the lookup fails with a 404
 * that reads exactly like a mistyped order id.
 *
 * As of 22 September 2026 they do match. The "Occasions Box" REST app under
 * PayPal's Apps & Credentials, created 17 September 2026, carries the same
 * client id the shop checks out with, so nothing needs swapping today. The
 * "BAA" prefix had me expecting a no-code button integration that would not
 * appear there at all; it is a REST app, and it is the one taking the money.
 *
 * This exists for the day that stops being true: a second app, a new PayPal
 * account, a shop pointed somewhere else. Then take the client id of the REST
 * app whose secret the CRM has and put it on the shop, so the two match by
 * construction and verification cannot be aimed at the wrong merchant.
 *
 * Usage:
 *   node tools/set-paypal-client-id.mjs <new-client-id>
 *   node tools/set-paypal-client-id.mjs <new-client-id> --dry-run
 *
 * It rewrites every shop page, the page generator that produces them, and the
 * copy the CRM compares against, so the three cannot drift apart. A client id
 * is public; it ships in the page source, so it is safe to pass on the
 * command line. The SECRET never appears here and never belongs in the repo.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Where the id appears, relative to the repository root. */
const TARGETS = [
  'site/shop.html',
  'tools/build-pages.mjs',
  'crm/src/lib/paypal.ts',
  ...readdirSync(join(ROOT, 'site/shop'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => `site/shop/${f}`),
]

/**
 * PayPal client ids are long, opaque and URL-safe. The length floor is the
 * real check: a truncated paste is the mistake this catches, and it would
 * otherwise be discovered by a customer.
 */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{40,120}$/

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const clientId = args.find((a) => !a.startsWith('--'))

  if (!clientId) {
    console.error('Usage: node tools/set-paypal-client-id.mjs <new-client-id> [--dry-run]')
    process.exit(1)
  }
  if (!CLIENT_ID_RE.test(clientId)) {
    console.error(
      `That does not look like a PayPal client id (got ${clientId.length} characters).\n` +
        'Expected 40 to 120 characters of letters, digits, hyphen and underscore.\n' +
        'Check for a truncated copy and paste.'
    )
    process.exit(1)
  }

  // The id in the files today, read rather than hardcoded, so this keeps
  // working after the first time it is used.
  const shopSource = readFileSync(join(ROOT, 'site/shop.html'), 'utf8')
  const current = shopSource.match(/client-id=([A-Za-z0-9_-]{40,120})/)?.[1]
  if (!current) {
    console.error('Could not find a PayPal client-id in site/shop.html. Nothing was changed.')
    process.exit(1)
  }
  if (current === clientId) {
    console.log(`Already set to ${clientId}. Nothing to do.`)
    return
  }

  console.log(`Replacing\n  ${current}\nwith\n  ${clientId}\n`)

  let changedFiles = 0
  let changedOccurrences = 0
  const untouched = []

  for (const rel of TARGETS) {
    const path = join(ROOT, rel)
    const before = readFileSync(path, 'utf8')
    if (!before.includes(current)) {
      untouched.push(rel)
      continue
    }
    const occurrences = before.split(current).length - 1
    const after = before.split(current).join(clientId)
    if (!dryRun) writeFileSync(path, after)
    changedFiles++
    changedOccurrences += occurrences
    console.log(`  ${rel} (${occurrences})`)
  }

  console.log(
    `\n${dryRun ? 'Would change' : 'Changed'} ${changedOccurrences} occurrence(s) across ${changedFiles} file(s).`
  )

  // A shop page that kept the old id would take money into an account the CRM
  // cannot verify against, which is the exact failure this script prevents.
  const strayPages = untouched.filter((f) => f.startsWith('site/'))
  if (strayPages.length > 0) {
    console.warn(
      `\nWarning: ${strayPages.length} shop page(s) did not contain the old id and were left alone:\n` +
        strayPages.map((f) => `  ${f}`).join('\n') +
        '\nCheck them by hand before deploying.'
    )
  }

  if (!dryRun) {
    console.log('\nNext: redeploy the ob-cinematic project, then re-run the PayPal')
    console.log('check in the CRM under Settings → Integrations to confirm it matches.')
  }
}

main()
