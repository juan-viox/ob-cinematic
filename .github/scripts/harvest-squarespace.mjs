#!/usr/bin/env node
/*
 * Pull every photograph and the product copy off the old Squarespace shop.
 *
 * Runs on a GitHub runner because that is the only place in this project's
 * toolchain that can reach occasionsbox.com. Everything it finds is committed,
 * so the sandbox can read it afterwards like any other file in the repo.
 *
 * Squarespace answers ?format=json-pretty with the page's own data. A product
 * page carries its gallery in item.items[].assetUrl and its copy in item.body.
 * When that endpoint is unavailable the HTML is scraped for CDN urls instead,
 * because a gallery we can only get the hard way still beats no gallery.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = 'https://www.occasionsbox.com';
const DEST = 'site/assets/img';
const MANIFEST = `${DEST}/manifest.tsv`;
const OUT = 'tools/squarespace-import.json';
const LIMIT = Number(process.env.LIMIT || 0);
const REJECTS = 'tools/harvest-rejects.txt';

/* Photographs a person looked at and turned down.
 *
 * The harvest fetches everything the old page holds, and a person then keeps
 * the handful worth showing and deletes the rest. Deleting them is not a
 * decision this script can see: the next run fetched them again and committed
 * them again, which is exactly what happened twice on Host's Delight. So the
 * rejection is written down instead, and the harvest reads it.
 *
 * A name in here is never downloaded, never added to the manifest and never
 * counted in the import record. Remove a line to let a photograph back in. */
function rejected() {
  let raw = '';
  try { raw = readFileSync(REJECTS, 'utf8'); } catch { return new Set(); }
  return new Set(
    raw.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
  );
}
const REJECTED = rejected();
if (REJECTED.size) console.log(`${REJECTED.size} photographs previously turned down; skipping them.`);

/* The redirects are the record of which old page became which box, so they are
   the list of pages to visit. Reading them here means the two cannot drift. */
function targets() {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const seen = new Map();
  for (const r of vercel.redirects || []) {
    const from = /^\/shop\/([^/]+)$/.exec(r.source || '');
    const to = /^\/shop\/([^/]+)$/.exec(r.destination || '');
    if (!from || !to) continue;
    /* Two old pages point at hosts-delight, one per colourway. Both are worth
       fetching, so they are kept as separate sources under the same box. */
    if (!seen.has(to[1])) seen.set(to[1], []);
    seen.get(to[1]).push(from[1]);
  }
  return [...seen.entries()].map(([slug, sources]) => ({ slug, sources }));
}

/* What each old slug has that its siblings do not: hostsdelightgreen and
   hostsdelightrose share "hostsdelight", so they tag as green and rose. Falls
   back to a position when they share nothing useful. */
function tagger(sources) {
  let prefix = 0;
  if (sources.length > 1) {
    const [first, ...rest] = sources;
    while (prefix < first.length && rest.every((s) => s[prefix] === first[prefix])) prefix++;
  }
  return (source) => {
    const tail = source.slice(prefix).replace(/[^a-z0-9]+/gi, '').toLowerCase();
    return tail || `p${sources.indexOf(source) + 1}`;
  };
}

const FETCH_TIMEOUT = 20_000;

async function get(url, asJson) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { 'user-agent': 'occasionsbox-migration (+https://github.com/juan-viox/ob-cinematic)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return asJson ? res.json() : res.text();
}

/* Squarespace serves whatever size you ask for off the same asset url. 1500w
   is enough for the lightbox without making the page heavy. */
const sized = (u, w) => `${u.split('?')[0]}?format=${w}w`;

function fromJson(data) {
  const item = data && (data.item || (data.items && data.items[0]));
  if (!item) return null;
  const gallery = (item.items || [])
    .map((i) => i.assetUrl)
    .filter((u) => typeof u === 'string' && u.startsWith('http'));
  if (item.assetUrl && !gallery.includes(item.assetUrl)) gallery.unshift(item.assetUrl);
  return { images: [...new Set(gallery)], body: item.body || item.excerpt || '' };
}

function fromHtml(html) {
  const urls = [...html.matchAll(/https:\/\/images\.squarespace-cdn\.com\/content\/v1\/[^"'\\\s?]+/g)]
    .map((m) => m[0])
    /* Skip the chrome: logos, favicons and the site's own furniture. */
    .filter((u) => !/logo|favicon|icon/i.test(u));
  return { images: [...new Set(urls)], body: '' };
}

const results = {};
const manifestLines = [];
let ok = 0, failed = 0;

for (const [n, t] of targets().entries()) {
  if (LIMIT && n >= LIMIT) { console.log(`Stopping after ${LIMIT} (limit set).`); break; }

  /* Every source, not just the first that answers. Host's Delight has one old
     page per colourway, and stopping at the first meant the rose box was never
     fetched while the green one filled its gallery. */
  const hits = [];
  console.log(`[${n + 1}] ${t.slug} ...`);
  for (const source of t.sources) {
    const url = `${SITE}/shop/${source}`;
    let parsed = null;
    try {
      parsed = fromJson(await get(`${url}?format=json-pretty`, true));
      if (!parsed || !parsed.images.length) {
        console.log(`::warning::${t.slug}: json had no gallery at ${source}`);
        parsed = null;
      }
    } catch (e) {
      console.log(`::warning::${t.slug}: json fetch failed at ${source} (${e.message}), trying html`);
    }
    if (!parsed) {
      try {
        const html = fromHtml(await get(url, false));
        if (html.images.length) parsed = html;
      } catch (e) {
        console.log(`::warning::${t.slug}: html fetch failed at ${source} (${e.message})`);
      }
    }
    if (parsed && parsed.images.length) hits.push({ ...parsed, source });
  }

  if (!hits.length) {
    console.log(`::error::${t.slug}: nothing found at ${t.sources.join(', ')}`);
    failed++;
    results[t.slug] = { sources: t.sources, images: [], body: '', error: 'not found' };
    continue;
  }

  /* A box with one source keeps its existing file names. A box with several
     tags each set with what its old slug does not share with the others, so
     hostsdelightgreen and hostsdelightrose become green and rose. */
  const tagFor = tagger(t.sources);
  const bySource = {};
  const allImages = [];
  const allFiles = [];
  let skipped = 0;
  for (const hit of hits) {
    const tag = hits.length > 1 ? `-${tagFor(hit.source)}` : '';
    /* Number every photograph the page holds before filtering, so a name is
       stable: dropping the seventh must not renumber the eighth into its
       place, or the rejection list would point at the wrong picture. */
    const numbered = hit.images.map((u, i) => ({ url: u, file: `${t.slug}${tag}-${i + 1}-1500w.jpg` }));
    const keep = numbered.filter((n) => !REJECTED.has(n.file));
    skipped += numbered.length - keep.length;
    keep.forEach((n) => manifestLines.push(`${n.file}\t${sized(n.url, 1500)}`));
    bySource[hit.source] = {
      tag: tag.replace(/^-/, ''), body: hit.body,
      images: keep.map((n) => n.url), files: keep.map((n) => n.file),
    };
    allImages.push(...keep.map((n) => n.url));
    allFiles.push(...keep.map((n) => n.file));
  }
  if (skipped) console.log(`${t.slug}: skipped ${skipped} previously turned down`);

  const lead = hits[0];
  results[t.slug] = {
    source: lead.source,
    body: hits.map((h) => h.body).find(Boolean) || '',
    images: allImages,
    files: allFiles,
    ...(hits.length > 1 ? { bySource } : {}),
  };
  console.log(`${t.slug.padEnd(20)} ${String(allImages.length).padStart(2)} photographs` +
              (hits.length > 1 ? ` across ${hits.length} pages` : '') +
              (results[t.slug].body ? `, ${results[t.slug].body.length} chars of copy` : ', no copy'));
  ok++;
}

writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');

/* Append only what is new, so re-running does not duplicate manifest rows. */
const existing = new Set(
  readFileSync(MANIFEST, 'utf8').split('\n').map((l) => l.split('\t')[0]).filter(Boolean)
);
const fresh = manifestLines.filter((l) => !existing.has(l.split('\t')[0]));
if (fresh.length) {
  const current = readFileSync(MANIFEST, 'utf8').replace(/\n*$/, '\n');
  writeFileSync(MANIFEST, current + fresh.join('\n') + '\n');
}
console.log(`\n${ok} boxes harvested, ${failed} failed. ${fresh.length} new manifest rows.`);

/* Download what was just added. localize-images.yml does this too, but a push
   made with GITHUB_TOKEN does not start another workflow, so it happens here. */
for (const line of fresh) {
  const [name, url] = line.split('\t');
  if (existsSync(`${DEST}/${name}`)) continue;
  try {
    execFileSync('curl', ['-fL', '--retry', '2', '--retry-delay', '2',
      '--connect-timeout', '15', '--max-time', '60', '-sS', '-o', '/tmp/dl', url],
      { timeout: 90_000 });
    execFileSync('convert', ['/tmp/dl[0]', `${DEST}/${name}`]);
  } catch (e) {
    console.log(`::error::could not fetch ${name}: ${e.message}`);
    failed++;
  }
}
console.log('Downloads complete.');

/* A total failure is a failed run; a few missing boxes is a result to read. */
if (ok === 0) { console.log('::error::nothing was harvested at all'); process.exit(1); }
