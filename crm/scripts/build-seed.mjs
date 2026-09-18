#!/usr/bin/env node
/*
 * Builds crm/supabase/seed/occasionsbox_catalogue.sql from the marketing site.
 *
 * The site's own catalogue (site/assets/js/site.js: allProducts and
 * PRODUCT_CONTENTS) is the source of truth for every box on sale, its price,
 * its photograph and what is inside it. Reading that file, rather than
 * retyping it, means the CRM catalogue can never disagree with the shop.
 *
 * On top of the boxes the seed carries what the site sells but does not list
 * as a product: the corporate tiers, the concierge plans, the add-ons, the
 * components inside each box as inventory, the gifting calendar and the
 * outreach email templates.
 *
 * The output is idempotent: re-running it against a live database refreshes
 * the catalogue (names, prices, contents, photographs) and never touches the
 * fields the team maintains by hand (stock, costs, reorder points, lead times,
 * whether something is active).
 *
 *   node scripts/build-seed.mjs        # from crm/
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const SITE_JS = path.join(REPO, 'site/assets/js/site.js');
const SHOP_HTML = path.join(REPO, 'site/shop.html');
const OUT = path.join(here, '..', 'supabase/seed/occasionsbox_catalogue.sql');

const ORG_SLUG = 'occasionsbox';
const ORG_NAME = 'OccasionsBox';
const ORG = `(SELECT id FROM organizations WHERE slug = '${ORG_SLUG}')`;

/* ─── Read the site ─────────────────────────────────────────────────────── */

const js = readFileSync(SITE_JS, 'utf8');

function extract(marker, open, close) {
  const start = js.indexOf(marker);
  if (start === -1) throw new Error(`site.js: ${marker} not found`);
  const from = js.indexOf(open, start);
  const end = js.indexOf(close, from);
  if (end === -1) throw new Error(`site.js: end of ${marker} not found`);
  return new Function(`return ${js.slice(from, end + close.length - 1)}`)();
}

const PRODUCTS = extract('var allProducts = [', '[', '\n  ];');
const CONTENTS = extract('var PRODUCT_CONTENTS = {', '{', '\n  };');
if (!Array.isArray(PRODUCTS) || !PRODUCTS.length) throw new Error('allProducts parsed to nothing');
for (const p of PRODUCTS) {
  if (!p.name || typeof p.price !== 'number' || !p.img) {
    throw new Error(`allProducts entry is missing a field: ${JSON.stringify(p)}`);
  }
  if (!CONTENTS[p.name]) throw new Error(`PRODUCT_CONTENTS has no entry for ${p.name}`);
}

/* The shop grid tags each card with the occasions it suits. Read them off the
   card's link so the tag follows the box into the CRM. */
const shop = readFileSync(SHOP_HTML, 'utf8');
const occasionsBySlug = new Map();
const cardRe = /class="shop-card[^"]*"[^>]*data-occasion="([^"]*)"[\s\S]*?href="\/shop\/([a-z0-9-]+)"/g;
let m;
while ((m = cardRe.exec(shop))) occasionsBySlug.set(m[2], m[1].split(/\s+/).filter(Boolean));
if (!occasionsBySlug.size) throw new Error('shop.html: no shop cards with data-occasion found');

/* Same rule the page builder uses, so /shop/<slug> and the CRM slug agree. */
function slugify(name) {
  return name.toLowerCase().replace(/&/g, '').replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ─── SQL helpers ───────────────────────────────────────────────────────── */

const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const arr = (xs) => (xs.length ? `ARRAY[${xs.map(q).join(', ')}]::text[]` : `'{}'::text[]`);
const jsonb = (v) => `${q(JSON.stringify(v))}::jsonb`;
const money = (n) => (n === null || n === undefined ? 'NULL' : Number(n).toFixed(2));

/* ─── Components: what is inside each box ───────────────────────────────── */

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const words = (s) => s.split(/\s+/).filter(Boolean).length;

/* A few lines on the site run two items together. Mark the seams so each
   becomes its own component. */
function splitMerged(line) {
  return line
    .replace(/([a-z\)])(Keepsake )/g, '$1 || $2')
    .replace(/\| *(Keepsake )/g, '|| $1')
    .replace(/phthalate(Eye Mask )/g, 'phthalate || $1');
}

function classify(brand, name) {
  const text = `${brand} ${name}`.toLowerCase();
  if (/keepsake|basket|wooden box/.test(text)) return 'packaging';
  if (/handwritten card|notebook|journal|pen\b|planner/.test(text)) return 'stationery';
  return 'component';
}

/* A segment that reads as a sentence is a description, not a product name. */
const sentencey = (s) => s.length > 60 || (s.length > 40 && /^(this|these|a|an|the)\s/i.test(s));
/* A short spec ("Camel color", "Red Tip") belongs to the item before it. */
const spec = (s) => words(s) <= 3 && /\d|\bcolou?r\b|\btip\b|\bscent\b|\bset of\b/i.test(s);

function parseComponent(raw) {
  const segs = raw.split('|').map(stripTags).filter(Boolean);
  if (!segs.length) return null;
  let brand = '';
  let name;
  let rest;
  if (/^a complimentary handwritten card/i.test(segs[0])) {
    return { brand: 'Occasions Box', name: 'Handwritten card', description: null, category: 'stationery' };
  }
  if (/keepsake|hand-woven basket/i.test(segs[0])) {
    // Packaging: "Occasions Box Keepsake box | measures 11” x 8.66” x 4.33”"
    name = segs[0].replace(/^occasions box\s+/i, '').replace(/^keepsake\s+box$/i, 'Keepsake box');
    return { brand: 'Occasions Box', name, description: segs.slice(1).join(' | ') || null, category: 'packaging' };
  }
  if (segs.length >= 2 && words(segs[0]) <= 4 && !sentencey(segs[1]) && !(words(segs[0]) >= 2 && spec(segs[1]))) {
    brand = segs[0];
    name = segs[1];
    rest = segs.slice(2);
  } else if (segs.length >= 2 && words(segs[0]) <= 2 && sentencey(segs[1])) {
    // "Grenville Society | Antiqued Gold Pineapple Corkscrew. The pineapple has..."
    brand = segs[0];
    const [head, ...tail] = segs[1].split(/(?<=[.:])\s+/);
    name = head.replace(/[.:]$/, '');
    rest = [tail.join(' '), ...segs.slice(2)].filter(Boolean);
  } else {
    name = segs[0];
    rest = segs.slice(1);
  }
  brand = brand.replace(/\.$/, '');
  return { brand, name, description: rest.join(' | ') || null, category: classify(brand, name) };
}

const componentKey = (c) => `${c.brand.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;

const items = new Map();       // key → component
const bom = [];                // { sku, key, sort }
for (const p of PRODUCTS) {
  let sort = 0;
  for (const line of CONTENTS[p.name]) {
    for (const piece of splitMerged(line).split('||')) {
      const c = parseComponent(piece);
      if (!c) continue;
      const key = componentKey(c);
      if (!items.has(key)) items.set(key, c);
      bom.push({ sku: `box-${slugify(p.name)}`, key, sort: sort++ });
    }
  }
}

/* ─── Catalogue beyond the shop: tiers, plans, add-ons ──────────────────── */

const TIERS = [
  { sku: 'tier-prestige', name: 'Prestige tier box', price: 225, price_note: 'per box · 12 box minimum',
    description: '5–7 premium items, hand-packed. The corporate and event tier most programmes start at.',
    contents: ['4–5 artisan items, hand-packed', 'Premium home goods', 'Artisan skincare or bath', 'Beverage item (tea, coffee)', 'Rigid keepsake box', 'Custom ribbon option'] },
  { sku: 'tier-luxe', name: 'Luxe tier box', price: 295, price_note: 'per box · 12 box minimum',
    description: '6–8 luxury items. Everything in Prestige plus a personalised element and a premium wooden or leather box.',
    contents: ['Everything in Prestige', 'Personalized element', 'Cashmere or silk item', 'Premium wooden or leather box', 'Custom branding available'] },
  { sku: 'tier-grand', name: 'Grand tier box', price: 395, price_note: 'from $395 per box · quoted',
    description: '8–10 luxury items, bespoke curation and custom-designed packaging. Quoted per programme.',
    contents: ['Everything in Luxe', 'Bespoke curation', 'Premium artisan spirits accessories', 'Custom-designed packaging', 'White-glove local delivery available'] },
];

const SERVICES = [
  { sku: 'svc-event-favors', name: 'Event favors', price: 38, unit: 'guest', price_note: 'from $38 per guest · 50 guest minimum',
    description: 'A clear tote or a boxed set, velvet ribbon and a tag printed with the host\'s name.' },
  { sku: 'svc-bespoke', name: 'Fully bespoke program', price: 5000, unit: 'project', price_note: 'from $5,000 in boxes',
    description: 'Custom sourcing, custom packaging and branding designed from scratch.' },
  { sku: 'svc-fulfillment', name: 'Fulfillment services', price: 0, unit: 'project', price_note: 'quoted per project',
    description: 'Client-supplied products: we handle packaging, fulfilment and shipping.' },
];

const PLANS = [
  { sku: 'plan-essential', name: 'Concierge · Essential', price: 199, price_note: 'per month · $2,388/year',
    description: 'For professionals gifting 1–2 times a month. Real estate agents and small practices.',
    contents: ['Up to 2 sends a month', 'Any tier box, billed at list', 'No order minimum', 'Dedicated gifting calendar', '25 recipient profiles', 'Handwritten notes included', 'Ground shipping included', 'Preview and approve each send', 'Quarterly review call'] },
  { sku: 'plan-professional', name: 'Concierge · Professional', price: 449, price_note: 'per month · $5,388/year',
    description: 'For active professionals gifting 3–5 times a month. Top agents, law firms, corporate teams.',
    contents: ['Up to 5 sends a month', 'Any tier box, billed at list', 'No order minimum', 'Priority 48hr turnaround', 'Rush delivery on request', '75 recipient profiles', 'Custom branding on boxes', 'Ground shipping included', 'Dedicated concierge contact', 'Monthly review calls', 'Unused sends roll over'] },
  { sku: 'plan-executive', name: 'Concierge · Executive', price: 899, price_note: 'per month · $10,788/year',
    description: 'Full-service concierge for high-volume gifters. Firms, practices and executives.',
    contents: ['Up to 10 sends a month', 'Any tier box, billed at list', 'No order minimum', 'Named personal concierge', 'Unlimited recipient profiles', 'Full custom branding suite', 'Ground shipping included', 'Same-day rush available', 'Proactive occasion reminders', 'Bulk event support', 'Annual strategy session', 'VIP packaging upgrades', 'Unused sends roll over, never expire'] },
];

const ADDONS = [
  { sku: 'addon-rush', name: 'Rush production', price: 0, price_note: 'quoted with proposal', description: 'Working inside the standard 2–4 week lead time (3–4 weeks mid October to December).' },
  { sku: 'addon-expedited-shipping', name: 'Expedited delivery', price: 0, price_note: 'quoted with proposal', description: 'Faster than ground. Billed in addition to the boxes.' },
  { sku: 'addon-hand-delivery', name: 'Hand delivery & on-site setup', price: 0, price_note: 'quoted with proposal', description: 'Within Bergen County and 25 miles of Fort Lee, NJ; beyond that by quote. A box at every seat, a display at reception.' },
  { sku: 'addon-design', name: 'Design & concept development', price: 0, price_note: 'quoted with proposal', description: 'Design fee for custom packaging, branding and concept work.' },
  { sku: 'addon-shipping', name: 'Nationwide ground shipping', price: 0, price_note: 'quoted with proposal', description: 'USPS or UPS, tracked. Included on concierge memberships.' },
  { sku: 'addon-custom-ribbon', name: 'Custom ribbon', price: 0, price_note: 'included from 25 boxes', description: 'Ribbon in the client\'s colour or with their name.' },
  { sku: 'addon-branding', name: 'Your branding on every box', price: 0, price_note: 'included from 50 boxes', description: 'Client logo on the box or the card.' },
  { sku: 'addon-handwritten-note', name: 'Handwritten note', price: 0, price_note: 'included', description: 'A handwritten card in every box.' },
];

/* ─── The gifting calendar ──────────────────────────────────────────────── */
/* weekday: 0 = Sunday … 6 = Saturday. lead_time_days: days before the date by
   which the proposal must be approved (production 2–4 weeks + transit; 3–4
   weeks in the holiday window). */
const OCCASIONS = [
  { slug: 'new-year', name: "New Year's Day", category: 'holiday', rule: 'fixed', month: 1, day: 1, lead: 35,
    talking: 'A fresh-start box for clients and teams; ships in the quiet week after Christmas only if approved by late November.', skus: ['box-cheers', 'box-uncorked', 'box-the-reset'] },
  { slug: 'lunar-new-year', name: 'Lunar New Year', category: 'holiday', rule: 'manual', month: 2, day: 17, lead: 28,
    description: '2026 date. Moves each year: update the day in December.', skus: ['box-afternoon-tea', 'box-cheers'] },
  { slug: 'valentines-day', name: "Valentine's Day", category: 'holiday', rule: 'fixed', month: 2, day: 14, lead: 28,
    talking: 'Personal gifts and client appreciation with warmth. Love You and Goodnight are the obvious pair.', skus: ['box-love-you', 'box-goodnight', 'box-everyday-luxe'] },
  { slug: 'employee-appreciation-day', name: 'Employee Appreciation Day', category: 'business', rule: 'nth_weekday', month: 3, weekday: 5, nth: 1, lead: 28,
    talking: 'First Friday of March. Team gifting at volume: 12 box minimum, branding from 50.', skus: ['box-the-reset', 'box-bright-side', 'box-coffee-lover', 'tier-prestige'] },
  { slug: 'international-womens-day', name: "International Women's Day", category: 'business', rule: 'fixed', month: 3, day: 8, lead: 28,
    talking: 'Women-owned since 2017; a natural fit for firms marking the day.', skus: ['box-everyday-luxe', 'box-spa-weekend', 'box-bright-side'] },
  { slug: 'administrative-professionals-day', name: 'Administrative Professionals Day', category: 'business', rule: 'last_full_week', month: 4, weekday: 3, lead: 28,
    description: 'The Wednesday of the last full week of April.', talking: 'Offices gift their assistants and office managers. Coffee Lover, Lemonade and Bright Side land well.', skus: ['box-coffee-lover', 'box-lemonade', 'box-bright-side'] },
  { slug: 'teacher-appreciation-week', name: 'Teacher Appreciation Week', category: 'seasonal', rule: 'nth_weekday', month: 5, weekday: 1, nth: 1, lead: 28,
    description: 'Starts the first Monday of May.', skus: ['box-afternoon-tea', 'box-bright-side'] },
  { slug: 'nurses-week', name: 'National Nurses Week', category: 'business', rule: 'fixed', month: 5, day: 6, lead: 28,
    description: '6–12 May every year.', talking: 'Healthcare clients (practices, hospitals) gift their nursing teams.', skus: ['box-the-reset', 'box-spa-weekend', 'box-mini-spa-day'] },
  { slug: 'mothers-day', name: "Mother's Day", category: 'holiday', rule: 'nth_weekday', month: 5, weekday: 0, nth: 2, lead: 28,
    skus: ['box-spa-weekend', 'box-mini-spa-day', 'box-everyday-luxe', 'box-peaches-cream'] },
  { slug: 'fathers-day', name: "Father's Day", category: 'holiday', rule: 'nth_weekday', month: 6, weekday: 0, nth: 3, lead: 28,
    skus: ['box-the-valet', 'box-uncorked', 'box-coffee-lover', 'box-the-wind-down'] },
  { slug: 'summer-client-appreciation', name: 'Summer client appreciation', category: 'seasonal', rule: 'fixed', month: 7, day: 15, lead: 28,
    talking: 'The gift that arrives when nothing is being asked for. Mid-year touchpoint for the concierge calendar.', skus: ['box-lemonade', 'box-peaches-cream', 'box-cheers'] },
  { slug: 'back-to-business', name: 'Back to business (September)', category: 'seasonal', rule: 'nth_weekday', month: 9, weekday: 1, nth: 2, lead: 28,
    talking: 'Welcome-back and new-hire gifting as offices fill up again after Labor Day.', skus: ['box-coffee-lover', 'box-the-reset', 'box-first-night-in'] },
  { slug: 'customer-service-week', name: 'Customer Service Week', category: 'business', rule: 'nth_weekday', month: 10, weekday: 1, nth: 1, lead: 28,
    description: 'First full week of October.', skus: ['box-coffee-lover', 'box-lemonade', 'box-bright-side'] },
  { slug: 'holiday-booking-deadline', name: 'Holiday programme booking deadline', category: 'internal', rule: 'fixed', month: 10, day: 15, lead: 0,
    description: 'Capacity is limited from mid October through December. Corporate holiday programmes should be approved by this date.', talking: 'Reach out in September: hold the December dates now, approve by 15 October.', skus: ['tier-prestige', 'tier-luxe', 'tier-grand'] },
  { slug: 'bosss-day', name: "Boss's Day", category: 'business', rule: 'fixed', month: 10, day: 16, lead: 28,
    skus: ['box-the-valet', 'box-uncorked', 'box-the-wind-down', 'box-the-nightcap'] },
  { slug: 'diwali', name: 'Diwali', category: 'holiday', rule: 'manual', month: 11, day: 8, lead: 28,
    description: '2026 date. Moves each year: update the day in December.', skus: ['box-afternoon-tea', 'box-bright-side', 'box-cheers'] },
  { slug: 'thanksgiving', name: 'Thanksgiving', category: 'holiday', rule: 'nth_weekday', month: 11, weekday: 4, nth: 4, lead: 35,
    talking: 'Hostess gifts and gratitude sends. The Dinner Party and Host\'s Delight are built for the table.', skus: ['box-the-dinner-party', 'box-hosts-delight', 'box-afternoon-tea', 'box-uncorked'] },
  { slug: 'hanukkah', name: 'Hanukkah', category: 'holiday', rule: 'manual', month: 12, day: 4, lead: 35,
    description: '2026: begins the evening of 4 December. Moves each year: update the day in December.', skus: ['box-cheers', 'box-afternoon-tea', 'box-the-nightcap'] },
  { slug: 'corporate-holiday-gifting', name: 'Corporate holiday gifting', category: 'business', rule: 'fixed', month: 12, day: 12, lead: 35,
    description: 'Target delivery window for December client and team programmes: the second week of December, before offices empty.', talking: 'Approve by early November; 3–4 week lead time in season plus 1–7 days transit.', skus: ['tier-prestige', 'tier-luxe', 'tier-grand', 'box-cheers'] },
  { slug: 'christmas', name: 'Christmas', category: 'holiday', rule: 'fixed', month: 12, day: 25, lead: 42,
    skus: ['box-cheers', 'box-the-nightcap', 'box-uncorked', 'box-goodnight'] },
  { slug: 'new-years-eve', name: "New Year's Eve", category: 'holiday', rule: 'fixed', month: 12, day: 31, lead: 42,
    skus: ['box-cheers', 'box-uncorked'] },
  { slug: 'closing-gift', name: 'Closing gift', category: 'real_estate', rule: 'manual', lead: 14,
    description: 'Per transaction: the date is the closing. Add it to the client\'s calendar from the agent\'s pipeline.', talking: 'Welcome Home, The New Keys and First Night In are the housewarming set; Prestige for standard closings, Luxe for $1M+, Grand for $2M+.', skus: ['box-welcome-home', 'box-the-new-keys', 'box-first-night-in', 'tier-prestige', 'tier-luxe'] },
  { slug: 'work-anniversary', name: 'Work anniversary', category: 'personal', rule: 'manual', lead: 21,
    description: 'Per employee: add each person\'s start date to the client\'s calendar.', skus: ['box-the-reset', 'box-coffee-lover', 'box-cheers'] },
  { slug: 'birthday', name: 'Birthday', category: 'personal', rule: 'manual', lead: 21,
    description: 'Per recipient: add the date to the client\'s calendar and it recurs every year.', skus: ['box-bright-side', 'box-everyday-luxe', 'box-the-valet'] },
  { slug: 'welcome-new-client', name: 'Welcome, new client', category: 'business', rule: 'manual', lead: 14,
    description: 'On signing. No fixed date: add it when the client is won.', skus: ['box-welcome-home', 'box-coffee-lover', 'tier-prestige'] },
  { slug: 'new-hire-welcome', name: 'New hire welcome', category: 'business', rule: 'manual', lead: 14,
    description: 'On start date.', skus: ['box-coffee-lover', 'box-the-reset', 'box-first-night-in'] },
  { slug: 'get-well', name: 'Get well', category: 'personal', rule: 'manual', lead: 3,
    description: 'Same week. Ships from stock on the shop\'s 1–3 day turnaround.', skus: ['box-the-reset', 'box-goodnight', 'box-afternoon-tea'] },
];

/* ─── Outreach email templates ──────────────────────────────────────────── */
/* Variables the compose page fills in: first_name, last_name, email, company,
   occasion, occasion_date, approve_by, proposal_number, proposal_link. */
const TEMPLATES = [
  {
    name: 'Holiday gifting: hold your December dates', category: 'reminder',
    subject: '{{first_name}}, shall we hold your December dates?',
    body: `Hi {{first_name}},

Every year the same thing happens: December arrives before the gifts do. We would rather not let that happen to {{company}}.

Our holiday capacity is limited from mid October through December, and corporate programmes need 3 to 4 weeks from approval plus shipping. If you tell us the recipient count and a budget per box now, we will hold the dates and send you a proposal to approve by 15 October.

Corporate boxes start at $225 (Prestige), with Luxe at $295 and Grand from $395. Your branding goes on every box from 50.

Shall I put together a proposal?

Warmly,
Occasions Box
(551) 246-0028 · Hello@occasionsbox.com`,
  },
  {
    name: 'Occasion coming up', category: 'reminder',
    subject: '{{occasion}} is on {{occasion_date}}: shall we get the boxes moving?',
    body: `Hi {{first_name}},

{{occasion}} lands on {{occasion_date}}. To have the boxes arrive on time we need your approval by {{approve_by}}.

Tell me how many recipients and whether last time's box should repeat or change, and I will send a proposal the same day.

Warmly,
Occasions Box
(551) 246-0028 · Hello@occasionsbox.com`,
  },
  {
    name: 'Proposal: here is your gifting proposal', category: 'proposal',
    subject: 'Your Occasions Box proposal {{proposal_number}}',
    body: `Hi {{first_name}},

Your proposal is ready: {{proposal_link}}

It lists every box, the quantity, the price and the ship date. If it is right, press Approve on that page and we start sourcing the same day. If anything should change, reply here and I will revise it.

The lead-time clock starts once the proposal is approved, payment has cleared and the recipient list is final.

Warmly,
Occasions Box
(551) 246-0028 · Hello@occasionsbox.com`,
  },
  {
    name: 'Proposal follow-up', category: 'follow-up',
    subject: 'Checking in on proposal {{proposal_number}}',
    body: `Hi {{first_name}},

A quick check on the proposal I sent over ({{proposal_link}}). Is there anything you would like changed, or a date I should be working back from?

If timing is the question: we hold your ship date in writing once the proposal is approved, and we tell you the moment anything puts it at risk.

Warmly,
Occasions Box
(551) 246-0028 · Hello@occasionsbox.com`,
  },
  {
    name: 'Closing gift for your buyer', category: 'follow-up',
    subject: 'A closing gift that lands with the keys',
    body: `Hi {{first_name}},

Congratulations on the closing. If you would like a gift waiting for your buyer on their first night in the house, we can have Welcome Home, The New Keys or First Night In there on the day, with a handwritten note from you.

Agents who close several deals a month use our concierge plan from $199 a month: we keep the calendar, curate each box and send it, and you only approve.

Would you like me to send one for this closing?

Warmly,
Occasions Box
(551) 246-0028 · Hello@occasionsbox.com`,
  },
  {
    name: 'After delivery: thank you', category: 'thank-you',
    subject: 'Thank you from Occasions Box',
    body: `Hi {{first_name}},

Your boxes have been delivered. Thank you for trusting us with the occasion.

If you have a moment, two things help us enormously: a photograph of the boxes where they landed, and a line about how they were received. And if there is a date coming up that we should already be planning for, tell me and it goes on your calendar.

Warmly,
Occasions Box
(551) 246-0028 · Hello@occasionsbox.com`,
  },
];

/* ─── Emit ──────────────────────────────────────────────────────────────── */

const out = [];
const emit = (s) => out.push(s);

emit(`-- OccasionsBox CRM — catalogue, inventory, gifting calendar and outreach templates.
-- GENERATED by crm/scripts/build-seed.mjs from site/assets/js/site.js and
-- site/shop.html. Do not edit by hand: change the site (or the script) and
-- re-run \`node scripts/build-seed.mjs\` from crm/.
--
-- Safe to re-run: refreshes names, prices, contents and photographs, and never
-- overwrites stock, costs, reorder points, lead times or is_active.
-- Run AFTER migrations 001–007. Works before the first team member signs up:
-- the organisation row is created here if it does not exist yet.

INSERT INTO organizations (name, slug) VALUES (${q(ORG_NAME)}, ${q(ORG_SLUG)})
  ON CONFLICT (slug) DO NOTHING;

-- Pipeline stages, mirroring src/crm.config.ts, only when the org has none.
INSERT INTO deal_stages (organization_id, name, color, sort_order, is_won, is_lost)
SELECT ${ORG}, s.name, s.color, s.sort_order, s.is_won, s.is_lost
FROM (VALUES
  ('Inquiry',     '#B8860B', 0, false, false),
  ('Quote Sent',  '#2C3E50', 1, false, false),
  ('Approved',    '#DAA520', 2, false, false),
  ('Fulfillment', '#CD853F', 3, false, false),
  ('Delivered',   '#228B22', 4, true,  false),
  ('Lost',        '#636e72', 5, false, true)
) AS s(name, color, sort_order, is_won, is_lost)
WHERE NOT EXISTS (SELECT 1 FROM deal_stages WHERE organization_id = ${ORG});
`);

const UPSERT_PRODUCT = `ON CONFLICT (organization_id, sku) WHERE sku IS NOT NULL DO UPDATE SET
  slug = EXCLUDED.slug, category = EXCLUDED.category, name = EXCLUDED.name,
  description = EXCLUDED.description, price = EXCLUDED.price, unit = EXCLUDED.unit,
  price_note = EXCLUDED.price_note, image_url = EXCLUDED.image_url,
  contents = EXCLUDED.contents, occasions = EXCLUDED.occasions, caution = EXCLUDED.caution,
  sort_order = EXCLUDED.sort_order, updated_at = now();`;

function productRow({ sku, slug, category, name, description, price, unit, price_note, image_url, contents, occasions, caution, sort }) {
  return `INSERT INTO products (organization_id, sku, slug, category, name, description, price, unit, price_note, image_url, contents, occasions, caution, sort_order, is_active)
VALUES (${ORG}, ${q(sku)}, ${q(slug)}, ${q(category)}, ${q(name)}, ${q(description)}, ${money(price)}, ${q(unit)}, ${q(price_note)}, ${q(image_url)}, ${jsonb(contents)}, ${arr(occasions)}, ${q(caution)}, ${sort}, true)
${UPSERT_PRODUCT}`;
}

emit('-- ── Boxes on sale in the shop ──────────────────────────────────────────');
PRODUCTS.forEach((p, i) => {
  const slug = slugify(p.name);
  if (!occasionsBySlug.has(slug)) throw new Error(`shop.html has no card for /shop/${slug}`);
  const contents = CONTENTS[p.name].map(stripTags);
  emit(productRow({
    sku: `box-${slug}`, slug, category: 'box', name: p.name,
    description: p.variants ? `Colourways: ${p.variants.map((v) => v.label).join(', ')}.` : null,
    price: p.price, unit: 'each', price_note: null, image_url: p.img, contents,
    occasions: occasionsBySlug.get(slug), caution: p.note ?? null, sort: (i + 1) * 10,
  }));
});

emit('\n-- ── Corporate and event tiers ──────────────────────────────────────────');
TIERS.forEach((t, i) => emit(productRow({ ...t, slug: t.sku, category: 'tier', unit: 'each', image_url: null, occasions: ['client'], caution: null, sort: 1000 + i * 10 })));
SERVICES.forEach((s, i) => emit(productRow({ ...s, slug: s.sku, category: 'service', price_note: s.price_note, image_url: null, contents: [], occasions: [], caution: null, sort: 1100 + i * 10 })));

emit('\n-- ── Gifting Concierge plans ────────────────────────────────────────────');
PLANS.forEach((p, i) => emit(productRow({ ...p, slug: p.sku, category: 'plan', unit: 'month', image_url: null, occasions: [], caution: null, sort: 1200 + i * 10 })));

emit('\n-- ── Add-ons quoted with a proposal ─────────────────────────────────────');
ADDONS.forEach((a, i) => emit(productRow({ ...a, slug: a.sku, category: 'addon', unit: 'each', image_url: null, contents: [], occasions: [], caution: null, sort: 1300 + i * 10 })));

emit('\n-- ── Inventory: every component inside the boxes ────────────────────────');
for (const c of items.values()) {
  emit(`INSERT INTO inventory_items (organization_id, brand, name, description, category)
VALUES (${ORG}, ${q(c.brand)}, ${q(c.name)}, ${q(c.description)}, ${q(c.category)})
ON CONFLICT (organization_id, lower(brand), lower(name)) DO UPDATE SET
  description = COALESCE(inventory_items.description, EXCLUDED.description), updated_at = now();`);
}

emit('\n-- ── Bill of materials: which components go in which box ──────────────');
for (const b of bom) {
  const c = items.get(b.key);
  emit(`INSERT INTO product_components (organization_id, product_id, inventory_item_id, quantity, sort_order)
SELECT ${ORG}, p.id, i.id, 1, ${b.sort}
FROM products p JOIN inventory_items i ON i.organization_id = p.organization_id
WHERE p.organization_id = ${ORG} AND p.sku = ${q(b.sku)}
  AND lower(i.brand) = lower(${q(c.brand)}) AND lower(i.name) = lower(${q(c.name)})
ON CONFLICT (product_id, inventory_item_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;`);
}

emit('\n-- ── The gifting calendar ───────────────────────────────────────────────');
OCCASIONS.forEach((o, i) => {
  emit(`INSERT INTO occasions (organization_id, slug, name, category, rule, month, day, weekday, nth, lead_time_days, description, talking_points, suggested_skus, sort_order)
VALUES (${ORG}, ${q(o.slug)}, ${q(o.name)}, ${q(o.category)}, ${q(o.rule)}, ${o.month ?? 'NULL'}, ${o.day ?? 'NULL'}, ${o.weekday ?? 'NULL'}, ${o.nth ?? 'NULL'}, ${o.lead}, ${q(o.description ?? null)}, ${q(o.talking ?? null)}, ${arr(o.skus ?? [])}, ${(i + 1) * 10})
ON CONFLICT (organization_id, slug) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, rule = EXCLUDED.rule,
  month = EXCLUDED.month, day = EXCLUDED.day, weekday = EXCLUDED.weekday, nth = EXCLUDED.nth,
  description = EXCLUDED.description, talking_points = EXCLUDED.talking_points,
  suggested_skus = EXCLUDED.suggested_skus, sort_order = EXCLUDED.sort_order, updated_at = now();`);
});

emit('\n-- ── Outreach email templates (only added when absent) ──────────────────');
for (const t of TEMPLATES) {
  const vars = [...new Set([...t.subject.matchAll(/\{\{(\w+)\}\}/g), ...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((x) => `{{${x[1]}}}`))];
  emit(`INSERT INTO email_templates (organization_id, name, subject, body, category, variables)
SELECT ${ORG}, ${q(t.name)}, ${q(t.subject)}, ${q(t.body)}, ${q(t.category)}, ${arr(vars)}
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE organization_id = ${ORG} AND name = ${q(t.name)});`);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join('\n') + '\n');
console.log(`${path.relative(REPO, OUT)}: ${PRODUCTS.length} boxes, ${TIERS.length + SERVICES.length} tiers/services, ${PLANS.length} plans, ${ADDONS.length} add-ons, ${items.size} components (${bom.length} links), ${OCCASIONS.length} occasions, ${TEMPLATES.length} templates`);
