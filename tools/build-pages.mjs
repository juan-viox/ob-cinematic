#!/usr/bin/env node
/**
 * Assembles the static multi-page site from shared partials and section
 * fragments, so the nav, footer and <head> stay identical across pages.
 *
 *   node tools/build-pages.mjs
 *
 * Reads : tools/partials/*.html, tools/sections/*.html
 * Writes: site/<slug>.html
 *
 * The output is committed; Vercel serves site/ directly with no build step,
 * so edit the partials and re-run this rather than editing site/*.html.
 */
import { readFileSync, writeFileSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\s+$/, '');
const partial = (n) => read(`tools/partials/${n}.html`);
const section = (n) => read(`tools/sections/${n}.html`);

/* The bare domain is the canonical one. www.occasionsbox.com stays
   registered and 301s here, so a link to either still works and only one
   of them accumulates credit with a search engine. */
const SITE = 'https://occasionsbox.com';

/* Every fact below is stated somewhere on the site; nothing here is invented.
   It feeds the JSON-LD that search engines read, so change it here and every
   page follows. */
const BIZ = {
  name: 'Occasions Box',
  legalName: 'Occasions Box LLC',
  founded: '2017',
  phone: '+1-551-246-0028',
  email: 'Hello@occasionsbox.com',
  locality: 'Fort Lee',
  region: 'NJ',
  country: 'US',
  blurb: 'Luxury curated gift boxes and corporate gifting, packed by hand in '
       + 'Fort Lee, New Jersey and shipped nationwide.',
  social: [
    'https://instagram.com/occasionsbox',
    'https://pinterest.com/occasionsbox',
    'https://facebook.com/occasionsbox',
    'https://www.linkedin.com/in/occasions-box-llc-7b7955192/',
  ],
};

/* PayPal's client id, supplied by Sarah from the PayPal dashboard. Public by
   design: it names the merchant to PayPal and appears in the page source of
   every page that can take a payment. */
const PAYPAL_CLIENT_ID = 'BAAxKYq3MeBz4sApUR0urJqOFrN8VZnJ9Oc5MUlUGlEo1Ts_fnFtZM7SixXtLZB6tSJiM_uql2IjEBA7Y0';

const ORG_ID = `${SITE}/#organization`;
const SITE_ID = `${SITE}/#website`;

/* Share cards, cropped to 1200x630 so Facebook, LinkedIn, iMessage and X all
   show the same frame instead of each picking its own crop of a tall photo.
   [path, alt]; the alt is read aloud by screen readers on X. */
const OG_DEFAULT = ['/assets/og/occasionsbox.jpg',
  'A charcoal Occasions Box gift box with a gold embossed lid and ivory ribbon'];
const OG = {
  shop: ['/assets/og/shop.jpg',
    'Two signature charcoal Occasions Box gift boxes tied with ivory ribbon'],
  'custom-gifting': ['/assets/og/custom-gifting.jpg',
    "Four charcoal gift boxes printed with a client's monogram, one open to show its contents"],
  concierge: ['/assets/og/concierge.jpg',
    'An open Occasions Box holding a candle, tea and a wooden serving board'],
  about: ['/assets/og/about.jpg',
    'A charcoal Occasions Box gift box held in one hand'],
  contact: ['/assets/og/contact.jpg',
    'An open Occasions Box with an olive wood board, a gold spoon and a soy candle'],
};
const ogFor = (page) => page.post
  ? [`/assets/og/journal/${page.post.slug}.jpg`, page.post.imageAlt]
  : page.product
  ? [`/assets/og/products/${slugify(page.product.name)}.jpg`,
     `${theName(page.product.name)} gift box from Occasions Box`]
  : (OG[page.slug] || OG_DEFAULT);

/* The shop grid is static HTML, so a crawler already sees 21 boxes. What it
   cannot see is which number is a price and whether the box is in stock, so
   read the same array the storefront uses and say so in JSON-LD. Parsing our
   own committed file keeps one source of truth: edit site.js and the
   structured data follows. */
function loadProducts() {
  const js = read('site/assets/js/site.js');
  const start = js.indexOf('var allProducts = [');
  if (start === -1) throw new Error('site.js: allProducts not found');
  const open = js.indexOf('[', start);
  const end = js.indexOf('\n  ];', open);
  if (end === -1) throw new Error('site.js: end of allProducts not found');
  const products = new Function(`return ${js.slice(open, end + 4)}`)();
  if (!Array.isArray(products) || !products.length) {
    throw new Error('site.js: allProducts parsed to nothing');
  }
  for (const p of products) {
    if (!p.name || typeof p.price !== 'number' || !p.img) {
      throw new Error(`site.js: allProducts entry is missing a field: ${JSON.stringify(p)}`);
    }
  }
  return products;
}
const PRODUCTS = loadProducts();

/* What is in each box, also lifted from site.js so the shop grid, the modal
   and the product pages can never disagree about a box's contents. */
function loadContents() {
  const js = read('site/assets/js/site.js');
  const start = js.indexOf('var PRODUCT_CONTENTS = {');
  if (start === -1) throw new Error('site.js: PRODUCT_CONTENTS not found');
  const open = js.indexOf('{', start);
  const end = js.indexOf('\n  };', open);
  if (end === -1) throw new Error('site.js: end of PRODUCT_CONTENTS not found');
  const map = new Function(`return ${js.slice(open, end + 4)}`)();
  if (!map || !Object.keys(map).length) {
    throw new Error('site.js: PRODUCT_CONTENTS parsed to nothing');
  }
  return map;
}
const CONTENTS = loadContents();

/* The prose that runs above the contents list, lifted from site.js for the
   same reason the contents are: the modal and the product page must not be
   able to describe the same box differently. A box with no story simply
   does not get the paragraph. */
function loadStories() {
  const js = read('site/assets/js/site.js');
  const start = js.indexOf('var PRODUCT_STORIES = {');
  if (start === -1) throw new Error('site.js: PRODUCT_STORIES not found');
  const open = js.indexOf('{', start);
  const end = js.indexOf('\n  };', open);
  if (end === -1) throw new Error('site.js: end of PRODUCT_STORIES not found');
  const map = new Function(`return ${js.slice(open, end + 4)}`)();
  if (!map || !Object.keys(map).length) {
    throw new Error('site.js: PRODUCT_STORIES parsed to nothing');
  }
  return map;
}
const STORIES = loadStories();

/* The six share networks, also from site.js, so the product pages and the
   modal can never offer a different set. */
function loadShareTargets() {
  const js = read('site/assets/js/site.js');
  const start = js.indexOf('var SHARE_TARGETS = [');
  if (start === -1) throw new Error('site.js: SHARE_TARGETS not found');
  const open = js.indexOf('[', start);
  const end = js.indexOf('\n  ];', open);
  if (end === -1) throw new Error('site.js: end of SHARE_TARGETS not found');
  const list = new Function(`return ${js.slice(open, end + 4)}`)();
  if (!Array.isArray(list) || !list.length) {
    throw new Error('site.js: SHARE_TARGETS parsed to nothing');
  }
  return list;
}
const SHARE_TARGETS = loadShareTargets();

/* The twenty one card messages, from site.js so the modal and the product
   page can never offer a different set. */
function loadCardMessages() {
  const js = read('site/assets/js/site.js');
  const start = js.indexOf('var CARD_MESSAGES = [');
  if (start === -1) throw new Error('site.js: CARD_MESSAGES not found');
  const open = js.indexOf('[', start);
  const end = js.indexOf('\n  ];', open);
  if (end === -1) throw new Error('site.js: end of CARD_MESSAGES not found');
  const list = new Function(`return ${js.slice(open, end + 4)}`)();
  if (!Array.isArray(list) || !list.length) throw new Error('site.js: CARD_MESSAGES parsed to nothing');
  return list;
}
const CARD_MESSAGES = loadCardMessages();

/* The shop grid tags every card with the occasions it suits. Reading them here
   lets a product page offer boxes for the same occasion rather than whichever
   four happen to sit next to it in the catalogue. */
function loadOccasions() {
  const shop = read('tools/sections/shop.html');
  const re = /class="shop-card[^"]*"[^>]*data-occasion="([^"]*)"[\s\S]*?href="\/shop\/([a-z0-9-]+)"/g;
  const map = new Map();
  let m;
  while ((m = re.exec(shop))) map.set(m[2], m[1].split(/\s+/).filter(Boolean));
  if (!map.size) throw new Error('tools/sections/shop.html: no cards with data-occasion');
  return map;
}
const OCCASIONS = loadOccasions();

/* The blank card is not a message, so it is not in CARD_MESSAGES, but it is
   an option in every picker. Taking it from site.js rather than repeating the
   words here is what keeps the product page and the modal offering the same
   list; they were already one option apart before this was read. */
function loadBlankCard() {
  const js = read('site/assets/js/site.js');
  const m = js.match(/var BLANK_CARD = '([^']+)';/);
  if (!m) throw new Error('site.js: BLANK_CARD not found');
  return m[1];
}
const BLANK_CARD = loadBlankCard();
const CARD_OPTIONS = CARD_MESSAGES.concat([BLANK_CARD]);

const cardPicker = () => `
      <div class="ob-card-pick">
        <label for="pdCard">Your handwritten card</label>
        <select id="pdCard"><option value="">Choose your card</option>${
          CARD_OPTIONS.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
        }</select>
        <label for="pdCardMsg">Your message</label>
        <textarea id="pdCardMsg" rows="2" maxlength="240"
                  placeholder="We will write this inside, by hand. Leave it blank for just the card."></textarea>
        <p class="ob-card-hint">Every box includes a 5x7 card, handwritten by us.</p>
      </div>`;

/* The modal builds its share links in the browser, so it has to slugify a box
   name to the same string this file does or every share link 404s. That is
   two copies of one rule in two languages, which is exactly the kind of thing
   that drifts silently, so the build compares them on every run. */
function assertSlugsAgree() {
  const js = read('site/assets/js/site.js');
  const m = js.match(/function slugifyName\(name\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error('site.js: slugifyName not found');
  const theirs = new Function(`return ${m[0].replace('function slugifyName', 'function')}`)();
  const wrong = PRODUCTS
    .map((p) => ({ name: p.name, mine: slugify(p.name), theirs: theirs(p.name) }))
    .filter((r) => r.mine !== r.theirs);
  if (wrong.length) {
    const lines = wrong.map((r) => `  ${r.name}: build-pages "${r.mine}" vs site.js "${r.theirs}"`);
    throw new Error(
      'slugify() and site.js slugifyName() disagree, so the modal share links\n' +
      'would not resolve. Make the two transforms identical:\n' + lines.join('\n')
    );
  }
}
assertSlugsAgree();

/* The product page renders its card picker here; the modal renders its own in
   the browser from cardOptionsHtml(). Two renderers, one list, and they were
   already one option apart the first time this was written: the product page
   offered the twenty one printed cards and the modal also offered the blank
   one. So the build runs site.js's own renderer and compares. */
function assertCardPickersAgree() {
  const js = read('site/assets/js/site.js');
  const m = js.match(/function cardOptionsHtml\(selected\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error('site.js: cardOptionsHtml not found');
  const theirs = new Function('CARD_MESSAGES', 'BLANK_CARD', 'escapeHtml',
    `return ${m[0].replace('function cardOptionsHtml', 'function')}`
  /* esc, not an identity stub: the product page escapes its option values,
     so an identity stub here reports "Mr &amp; Mrs" against "Mr & Mrs" and
     fails a picker that is actually identical. */
  )(CARD_MESSAGES, BLANK_CARD, esc);

  const values = [...theirs('').matchAll(/<option value="([^"]*)"/g)]
    .map((r) => r[1]).filter(Boolean);
  /* Read what cardPicker() actually renders, not the list it is supposed to
     read from. The first version of this compared CARD_OPTIONS to site.js and
     passed while cardPicker() was still mapping CARD_MESSAGES, which is the
     bug it was written to catch. */
  const mine = [...cardPicker().matchAll(/<option value="([^"]*)"/g)]
    .map((r) => r[1]).filter(Boolean);
  const same = values.length === mine.length && values.every((v, i) => v === mine[i]);
  if (!same) {
    throw new Error(
      'The product page and the modal offer different cards.\n' +
      `  build-pages (${mine.length}): ${mine.join(' | ')}\n` +
      `  site.js     (${values.length}): ${values.join(' | ')}`
    );
  }
}
assertCardPickersAgree();

/* Built here rather than in the browser so the links are in the HTML a
   crawler sees, and so they still work with JavaScript switched off. */
function shareRow(url, title, image) {
  const links = SHARE_TARGETS.map((t) => {
    const href = t.href
      .replace('{url}', encodeURIComponent(url))
      .replace('{title}', encodeURIComponent(title))
      .replace('{image}', encodeURIComponent(image || ''));
    return `<a class="share-link" href="${href}" target="_blank" rel="noopener noreferrer" ` +
           `aria-label="Share ${esc(title)} on ${t.name}" title="Share on ${t.name}">` +
           `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${t.icon}"/></svg></a>`;
  }).join('');
  return `\n      <div class="share-row">${links}</div>`;
}

/* Each box gets its own address. Until now all 21 lived behind one /shop URL
   and a modal, so nothing could be linked to, shared or found by name. */
const productUrl = (p) => `/shop/${slugify(p.name)}`;

/* The makers are the reason these boxes cost what they do, so the search
   result names them. Items read "<b>Brand</b> | description"; a few lead with
   the description instead, and those are skipped rather than guessed at. */
function makersIn(name) {
  const seen = [];
  for (const item of CONTENTS[name] || []) {
    const m = /^<b>\s*([^<|]+?)\s*(?:<\/b>|\|)/.exec(item);
    if (!m) continue;
    const brand = m[1].replace(/\.$/, '').trim();
    if (brand && !/^(OB|Occasions Box|Keepsake)/i.test(brand) && !seen.includes(brand)) {
      seen.push(brand);
    }
    if (seen.length === 3) break;
  }
  return seen;
}

function productDesc(p) {
  const makers = makersIn(p.name);
  const made = makers.length >= 2
    ? `Inside: ${makers.slice(0, -1).join(', ')} and ${makers.at(-1)}. `
    : '';
  return `${p.name}, $${p.price}. ${made}Packed by hand in Fort Lee, New Jersey, `
       + 'finished with a handwritten note and shipped nationwide.';
}

/* A schema.org graph per page. One <script> holds the lot; the @id references
   let the nodes point at each other instead of repeating the business. */
function ldGraph(page) {
  const canonical = SITE + page.url;
  const [ogPath] = ogFor(page);

  const org = {
    '@type': ['Organization', 'LocalBusiness'],
    '@id': ORG_ID,
    name: BIZ.name,
    legalName: BIZ.legalName,
    foundingDate: BIZ.founded,
    url: `${SITE}/`,
    logo: { '@type': 'ImageObject', url: `${SITE}/assets/ob-logo-gold.png`, width: 1718, height: 341 },
    image: `${SITE}${OG_DEFAULT[0]}`,
    description: BIZ.blurb,
    email: BIZ.email,
    telephone: BIZ.phone,
    priceRange: '$$$',
    address: {
      '@type': 'PostalAddress',
      addressLocality: BIZ.locality,
      addressRegion: BIZ.region,
      addressCountry: BIZ.country,
    },
    areaServed: [
      { '@type': 'Country', name: 'United States' },
      { '@type': 'AdministrativeArea', name: 'Bergen County, New Jersey' },
    ],
    founder: [
      { '@type': 'Person', name: 'Kari Aragon', jobTitle: 'Co-Founder & CEO' },
      { '@type': 'Person', name: 'Sarah De Jesus', jobTitle: 'Co-Founder & Chief Creative Officer' },
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      email: BIZ.email,
      telephone: BIZ.phone,
      areaServed: 'US',
      availableLanguage: ['English'],
    },
    sameAs: BIZ.social,
  };

  const website = {
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: `${SITE}/`,
    name: BIZ.name,
    inLanguage: 'en-US',
    publisher: { '@id': ORG_ID },
  };

  const webpage = {
    '@type': page.pageType || 'WebPage',
    '@id': `${canonical}#webpage`,
    url: canonical,
    name: page.title,
    description: page.desc,
    inLanguage: 'en-US',
    isPartOf: { '@id': SITE_ID },
    about: { '@id': ORG_ID },
    primaryImageOfPage: { '@type': 'ImageObject', url: SITE + ogPath },
  };

  const graph = [org, website, webpage];

  /* Home is the root, so a one-item trail would be noise. */
  if (page.url !== '/') {
    const trail = page.product
      ? [['Home', `${SITE}/`], ['Shop', `${SITE}/shop`], [page.product.name, canonical]]
      : page.post
      ? [['Home', `${SITE}/`], ['Journal', `${SITE}/journal`], [page.post.title, canonical]]
      : [['Home', `${SITE}/`], [page.title.split(' | ')[0], canonical]];
    webpage.breadcrumb = { '@id': `${canonical}#breadcrumb` };
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: trail.map(([name, item], n) => (
        { '@type': 'ListItem', position: n + 1, name, item })),
    });
  }

  if (page.post) {
    graph.push({
      '@type': 'BlogPosting',
      '@id': `${canonical}#post`,
      headline: page.post.title,
      description: page.post.summary,
      image: SITE + page.post.image,
      datePublished: page.post.date,
      dateModified: page.post.date,
      inLanguage: 'en-US',
      mainEntityOfPage: { '@id': `${canonical}#webpage` },
      author: { '@id': ORG_ID },
      publisher: { '@id': ORG_ID },
    });
    webpage.mainEntity = { '@id': `${canonical}#post` };
  }

  if (page.product) {
    const p = page.product;
    graph.push({
      '@type': 'Product',
      '@id': `${canonical}#product`,
      name: p.name,
      /* Google shows a gallery against a product result when the markup
         offers one. Now that a box has six photographs rather than one, it
         should be advertising all of them, not just the card shot. */
      image: [...new Set([...(p.images || [p.img]), ogPath].map((i) => SITE + i))],
      description: page.desc,
      brand: { '@type': 'Brand', name: BIZ.name },
      category: 'Gift Boxes',
      sku: slugify(p.name),
      offers: {
        '@type': 'Offer',
        price: p.price.toFixed(2),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/NewCondition',
        url: canonical,
        seller: { '@id': ORG_ID },
      },
    });
    webpage.mainEntity = { '@id': `${canonical}#product` };
  }

  if (page.slug === 'shop') {
    graph.push({
      '@type': 'ItemList',
      '@id': `${canonical}#products`,
      name: 'Ready-to-gift boxes',
      numberOfItems: PRODUCTS.length,
      itemListElement: PRODUCTS.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          '@id': `${SITE}${productUrl(p)}#product`,
          name: p.name,
          image: SITE + p.img,
          /* p.note is an allergen or suitability warning where one exists; it
             is the only per-box prose we hold, and it is the sentence a buyer
             most needs. Everything else gets the house description. */
          description: p.note
            ? `A curated Occasions Box gift box, packed by hand and finished with a handwritten card. ${p.note}`
            : 'A curated Occasions Box gift box, packed by hand and finished with a handwritten card.',
          brand: { '@type': 'Brand', name: BIZ.name },
          category: 'Gift Boxes',
          url: SITE + productUrl(p),
          offers: {
            '@type': 'Offer',
            price: p.price.toFixed(2),
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition',
            url: SITE + productUrl(p),
            seller: { '@id': ORG_ID },
          },
        },
      })),
    });
  }

  if (page.slug === 'custom-gifting') {
    graph.push({
      '@type': 'Service',
      '@id': `${canonical}#service`,
      name: 'Corporate and custom gifting',
      serviceType: 'Corporate gifting',
      description: 'Custom gift programs for clients, teams, weddings and events, '
        + 'from curation and branding through to packing and delivery.',
      provider: { '@id': ORG_ID },
      areaServed: { '@type': 'Country', name: 'United States' },
      offers: {
        '@type': 'Offer',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'PriceSpecification',
          minPrice: 225,
          priceCurrency: 'USD',
          description: 'Per box, from the Prestige tier. Twelve box minimum.',
        },
        eligibleQuantity: { '@type': 'QuantitativeValue', minValue: 12, unitText: 'boxes' },
      },
    });
  }

  if (page.slug === 'concierge') {
    graph.push({
      '@type': 'Service',
      '@id': `${canonical}#service`,
      name: 'Gifting Concierge',
      serviceType: 'Gift concierge',
      description: 'A managed gifting calendar. We hold the dates, curate each box, '
        + 'write the note and send it, with every gift approved by you first.',
      provider: { '@id': ORG_ID },
      areaServed: { '@type': 'Country', name: 'United States' },
      offers: [199, 449, 899].map((price) => ({
        '@type': 'Offer',
        price: price.toFixed(2),
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: price.toFixed(2),
          priceCurrency: 'USD',
          billingIncrement: 1,
          unitText: 'MONTH',
        },
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

/* Six of the boxes are called "The Something", so the article is already
   there and a second one reads as a stutter in the alt text. */
function theName(name) {
  return /^the\s/i.test(name) ? name : `The ${name}`;
}

function slugify(s) {
  /* Drop the apostrophe rather than turn it into a separator, so Host's
     Delight is hosts-delight and not host-s-delight. */
  return s.toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const NAV = partial('nav');
const FOOTER_RAW = partial('footer');
const MODAL = partial('modal');
const CART = partial('cart');
const WIDGETS = partial('widgets');

/** slug → output file; url → canonical path; nav → which nav item is current */
const PAGES = [
  {
    slug: 'index', url: '/', nav: 'home',
    title: 'Custom Gift Boxes & Corporate Gifting NJ | Occasions Box',
    desc: 'Luxury custom gift boxes and corporate gifting, packed by hand in Fort Lee, New Jersey and shipped nationwide. Now booking Holiday 2026.',
    sections: ['hero', 'custom-band', 'products', 'concierge-teaser', 'testimonials', 'clients', 'connect'],
  },
  {
    slug: 'shop', url: '/shop', nav: 'shop',
    title: 'Shop Luxury Gift Boxes, Ready to Send | Occasions Box',
    desc: 'Curated luxury gift boxes from $105, already packed and ribboned. Hand-finished with a handwritten note and shipped nationwide from New Jersey.',
    header: {
      eyebrow: 'Ready to Gift',
      h1: 'Wrapped &amp; Waiting',
      p: 'Curated boxes that are already packed, ribboned and finished with a handwritten note; pick one and it ships. Need something bespoke? We build those too.',
    },
    sections: ['shop'],
    modal: true, cart: true, paypal: true,
  },
  {
    slug: 'custom-gifting', url: '/custom-gifting', nav: 'custom-gifting',
    title: 'Corporate Gifting & Custom Gift Boxes | Occasions Box',
    desc: 'Corporate gift boxes from $225, twelve box minimum, with your branding from fifty. Curation, packing and delivery handled end to end from New Jersey.',
    header: {
      eyebrow: 'Business + Custom Gifting',
      h1: 'Gifting, Handled End to End',
      p: 'We build custom gift programs for clients, teams and milestones, and our concierge handles them from concept to delivery.',
    },
    sections: ['occasions', 'howitworks', 'pricing', 'concierge-teaser'],
  },
  {
    slug: 'concierge', url: '/concierge', nav: 'concierge',
    title: 'Gifting Concierge Service | Occasions Box',
    desc: 'A managed gifting calendar for the year. We hold the dates, curate the boxes, write the notes and send them. Plans from $199 a month, no order minimum.',
    header: {
      eyebrow: 'Gifting Concierge',
      h1: 'Gift All Year, Decide Once',
      p: 'Most gifting goes wrong the same way: the date arrives before the gift does. We hold the calendar, curate each box and send it, so the only thing left for you is to approve it.',
    },
    sections: ['concierge'],
  },
  {
    slug: 'about', url: '/about', nav: 'about',
    title: 'About Us | Occasions Box, Fort Lee NJ',
    desc: 'Occasions Box is a sister-run gift studio in Fort Lee, New Jersey, curating elevated, deeply personal gifts. Meet the founders and see how we work.',
    header: {
      eyebrow: 'About Us',
      h1: 'Gifting Should Feel Effortless',
      p: 'Every box is packed by hand with high-quality items and finished ready to give, so marking the moment takes one decision instead of ten.',
    },
    sections: ['about', 'founders', 'clients'],
  },
  {
    slug: 'contact', url: '/contact', nav: 'contact',
    title: 'Contact & Custom Gift Requests | Occasions Box',
    desc: 'Start a custom gift or request corporate gifting pricing. Based in Bergen County, New Jersey, shipping nationwide. We reply within two business days.',
    header: {
      eyebrow: 'Get in Touch',
      h1: 'Start Your Gift',
      p: 'Tell us about the occasion, the recipients and the timeline. We reply within two business days.',
    },
    sections: ['contact', 'newsletter'],
  },
  {
    slug: 'shipping-returns', url: '/shipping-returns', nav: '',
    title: 'Shipping & Returns | Occasions Box',
    desc: 'How Occasions Box ships, what local hand delivery covers, and what happens if a gift arrives damaged. All sales are final.',
    header: {
      eyebrow: 'Policies',
      h1: 'Shipping &amp; Returns',
      p: 'How your gifts get there, what it costs, and what we do when something goes wrong.',
    },
    sections: ['shipping-returns'],
  },
  {
    slug: 'terms-and-conditions', url: '/terms-and-conditions', nav: '',
    title: 'Terms & Conditions | Occasions Box',
    desc: 'The terms that govern orders placed with Occasions Box, including custom and corporate gifting.',
    header: {
      eyebrow: 'Policies',
      h1: 'Terms &amp; Conditions',
      p: 'The agreement behind every order, in plain language.',
    },
    sections: ['terms'],
  },
];

/* Photographs are not one shape: most are 5:4, several 3:2, one square. The
   markup states each file's real size so the browser reserves the right box
   and the page does not jump while the photo loads. */
function jpegSize(file) {
  const buf = readFileSync(join(ROOT, file));
  if (buf.readUInt16BE(0) !== 0xffd8) throw new Error(`${file}: not a JPEG`);
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`${file}: no frame header`);
}

/* ── Product pages ─────────────────────────────────────────────────────────
   One page per box, built from the same catalogue the grid renders from, so
   a price or a contents list can only ever be changed in one place. */
function productBody(p) {
  const contents = CONTENTS[p.name];
  const variants = p.variants || [];
  const img = p.img;
  const { w, h } = jpegSize(`site${img}`);
  const i = PRODUCTS.indexOf(p);
  /* Somebody on a box that is nearly right wants the next nearest box, not
     the next one along in the catalogue. Boxes sharing an occasion tag come
     first, most tags in common first; the cyclic neighbours fill any gap so
     there are always four. */
  const mine = new Set(OCCASIONS.get(slugify(p.name)) || []);
  const shared = (q) => (OCCASIONS.get(slugify(q.name)) || []).filter((t) => mine.has(t)).length;
  const byOccasion = PRODUCTS
    .filter((q) => q !== p && shared(q) > 0)
    .sort((a, b) => shared(b) - shared(a) || PRODUCTS.indexOf(a) - PRODUCTS.indexOf(b));
  const neighbours = [1, 2, 3, 4].map((k) => PRODUCTS[(i + k) % PRODUCTS.length]);
  const related = [...new Set([...byOccasion, ...neighbours])].filter((q) => q !== p).slice(0, 4);

  const variantBlock = variants.length ? `
      <div class="pd-variants">
        <div class="pd-variants-label">Choose your colour</div>
${variants.map((v, n) => `        <button type="button" class="pd-variant${n === 0 ? ' active' : ''}" data-variant="${n}">${v.label}</button>`).join('\n')}
      </div>` : '';

  const story = STORIES[p.name];
  const storyBlock = story ? `\n      <p class="pd-story">${esc(story)}</p>` : '';

  /* A box with several photographs gets a strip under the main one. On a box
     with colourways the strip belongs to the colourway, so it starts on the
     first one and site.js repaints it when the buyer picks the other; the
     container is emitted either way so there is something to repaint into,
     carrying hidden when the opening colourway has a single photograph.
     site.js turns these into the lightbox gallery, so adding a photograph
     here is a one line data change. */
  const firstVariant = variants[0];
  const gallery = ((firstVariant && (firstVariant.images || (firstVariant.img && [firstVariant.img])))
      || p.images || [p.img])
    .map((e) => (typeof e === 'string' ? { src: e, alt: '' } : e))
    .filter((e) => e && e.src);
  const anyMultiple = gallery.length > 1 ||
    variants.some((v) => (v.images || []).length > 1) || (p.images || []).length > 1;
  const thumbs = anyMultiple ? `
      <div class="pd-thumbs"${gallery.length > 1 ? '' : ' hidden'}>
${gallery.map((g, n) => `        <button type="button" class="pd-thumb${n === 0 ? ' active' : ''}" aria-label="Show photograph ${n + 1} of ${gallery.length}"><img src="${g.src}" alt="" loading="lazy" width="74" height="74"></button>`).join('\n')}
      </div>` : '';

  const contentsBlock = contents && contents.length ? `
      <div class="pd-contents" id="pdContents">
        <div class="pd-contents-title">Box includes</div>
        <ul>
${contents.map((item) => `          <li>${item}</li>`).join('\n')}
        </ul>
      </div>` : `
      <p class="pd-generic">Thoughtfully curated gift box featuring premium artisan products, beautifully wrapped with tissue and ribbon, ready to delight.</p>`;
  const bodyBlock = story ? contentsBlock.replace(/\n\s*<p class="pd-generic">[\s\S]*?<\/p>/, '') : contentsBlock;

  const cautionBlock = p.note
    ? `\n      <p class="pd-caution">${p.note}</p>` : '';

  return `<!-- ═══ PRODUCT: ${p.name} ═══ -->
<article class="pd" data-product="${esc(p.name)}">
  <nav class="pd-crumb" aria-label="Breadcrumb">
    <a href="/">Home</a> <span aria-hidden="true">&rsaquo;</span>
    <a href="/shop">Shop</a> <span aria-hidden="true">&rsaquo;</span>
    <span aria-current="page">${p.name}</span>
  </nav>

  <div class="pd-grid">
    <figure class="pd-gallery">
      <img id="pdImg" src="${img}" width="${w}" height="${h}" fetchpriority="high"
           alt="${theName(p.name)} gift box from Occasions Box">${thumbs}
    </figure>

    <div class="pd-body">
      <h1 class="pd-name">${p.name}</h1>
      <div class="pd-price">$${p.price.toFixed(2)}</div>${storyBlock}${variantBlock}${bodyBlock}${cautionBlock}
      <p class="pd-sub">Contents are sourced from small makers in small batches. If one sells out or changes a product, we substitute something of equal or greater value in keeping with the box. Photographs show a representative selection.</p>

${cardPicker()}

      <div class="pd-buy">
        <div class="pd-qty">
          <label for="pdQty">Qty</label>
          <input type="number" id="pdQty" value="1" min="1" max="20">
        </div>
        <button type="button" class="pd-add" id="pdAdd">Add to Cart</button>
      </div>
      <div class="pd-share-label">Share the box</div>${shareRow(`${SITE}${productUrl(p)}`, `${p.name} from Occasions Box`, `${SITE}${p.img}`)}

      <p class="pd-ship">The box is the wrapping &middot; Handwritten 5x7 note included &middot; Ships nationwide</p>
    </div>
  </div>

  <section class="pd-more">
    <h2 class="pd-more-title">More beautiful boxes to consider</h2>
    <div class="pd-more-grid">
${related.map((r) => {
  const rs = jpegSize(`site${r.img}`);
  return `      <a class="pd-more-card" href="${productUrl(r)}">
        <img src="${r.img}" width="${rs.w}" height="${rs.h}" loading="lazy" alt="${theName(r.name)} gift box">
        <span class="pd-more-name">${r.name}</span>
        <span class="pd-more-price">$${r.price.toFixed(2)}</span>
      </a>`;
}).join('\n')}
    </div>
    <p class="pd-more-all"><a href="/shop">See all ${PRODUCTS.length} boxes</a></p>
  </section>
</article>
`;
}

const PRODUCT_PAGES = PRODUCTS.map((p) => ({
  slug: `shop/${slugify(p.name)}`,
  url: productUrl(p),
  nav: 'shop',
  title: `${p.name} Gift Box, $${p.price} | Occasions Box`,
  desc: productDesc(p),
  sections: [],
  html: productBody(p),
  product: p,
  cart: true,
  paypal: true,
}));

/* ── Journal ───────────────────────────────────────────────────────────────
   One file per post in tools/posts/, each opening with a metadata comment.
   Adding a post is writing that one file: the post page, the index, the share
   meta, the structured data and the sitemap all follow from it.

   With no posts the section does not exist at all: no page, no link, no
   sitemap entry. An empty index is a thin page, and a thin page is worse for
   the site than no page. */
function loadPosts() {
  let files;
  try {
    files = readdirSync(join(ROOT, 'tools/posts')).filter((f) => f.endsWith('.html'));
  } catch { return []; }

  const posts = files.map((file) => {
    const raw = read(`tools/posts/${file}`);
    const head = /^\s*<!--([\s\S]*?)-->/.exec(raw);
    if (!head) throw new Error(`tools/posts/${file}: missing the metadata comment`);
    const meta = {};
    for (const line of head[1].split('\n')) {
      const m = /^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/.exec(line);
      if (m) meta[m[1]] = m[2];
    }
    for (const key of ['title', 'date', 'summary', 'image', 'imageAlt']) {
      if (!meta[key]) throw new Error(`tools/posts/${file}: no ${key} in the metadata comment`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
      throw new Error(`tools/posts/${file}: date must be YYYY-MM-DD, got ${meta.date}`);
    }
    if (meta.order !== undefined && !/^[1-9]\d*$/.test(meta.order)) {
      throw new Error(`tools/posts/${file}: order must be a positive whole number, got ${meta.order}`);
    }
    return { ...meta, slug: file.replace(/\.html$/, ''), body: raw.slice(head[0].length).trim() };
  });

  /* Newest first is what a reader and a crawler both expect, and it is the
     right default for a journal that fills up over time. It is the wrong
     answer on the day several posts go live together: the dates are all the
     same, and even when they are not, "published first" and "shown first"
     point in opposite directions. An explicit order wins where it is given,
     so the sequence a piece was written to be read in survives the dates.
     Posts without one fall in behind, newest first. */
  return posts.sort((a, b) => {
    const ao = a.order ? Number(a.order) : Infinity;
    const bo = b.order ? Number(b.order) : Infinity;
    return ao !== bo ? ao - bo : b.date.localeCompare(a.date);
  });
}
const POSTS = loadPosts();

const readable = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                 'August', 'September', 'October', 'November', 'December'][m - 1];
  return `${month} ${d}, ${y}`;
};

function postCard(post) {
  const { w, h } = jpegSize(`site${post.image}`);
  return `      <a class="jr-card" href="/journal/${post.slug}">
        <img src="${post.image}" width="${w}" height="${h}" loading="lazy" alt="${esc(post.imageAlt)}">
        <time class="jr-card-date" datetime="${post.date}">${readable(post.date)}</time>
        <h2 class="jr-card-title">${post.title}</h2>
        <p class="jr-card-summary">${post.summary}</p>
        <span class="jr-card-more">Read on</span>
      </a>`;
}

function journalIndexBody() {
  return `<!-- ═══ JOURNAL INDEX ═══ -->
<section class="jr-index">
  <div class="jr-grid">
${POSTS.map(postCard).join('\n')}
  </div>
</section>
`;
}

function postBody(post) {
  const { w, h } = jpegSize(`site${post.image}`);
  const others = POSTS.filter((o) => o.slug !== post.slug).slice(0, 3);
  return `<!-- ═══ JOURNAL POST: ${post.title} ═══ -->
<article class="jr-post">
  <nav class="jr-crumb" aria-label="Breadcrumb">
    <a href="/">Home</a> <span aria-hidden="true">&rsaquo;</span>
    <a href="/journal">Journal</a> <span aria-hidden="true">&rsaquo;</span>
    <span aria-current="page">${post.title}</span>
  </nav>

  <header class="jr-post-head">
    <time class="jr-post-date" datetime="${post.date}">${readable(post.date)}</time>
    <h1 class="jr-post-title">${post.title}</h1>
    <p class="jr-post-standfirst">${post.summary}</p>
  </header>

  <figure class="jr-post-figure">
    <img src="${post.image}" width="${w}" height="${h}" fetchpriority="high" alt="${esc(post.imageAlt)}">
  </figure>

  <div class="jr-post-body">
${post.body}
  </div>

  <div class="jr-post-foot">
    <p class="jr-post-cta">Occasions Box curates custom gift boxes from our studio in Fort Lee, New Jersey.
      <a href="/shop">See the boxes</a> or <a href="/contact">tell us about the occasion</a>.</p>
  </div>
${others.length ? `
  <section class="jr-more">
    <h2 class="jr-more-title">More from the journal</h2>
    <div class="jr-grid">
${others.map(postCard).join('\n')}
    </div>
  </section>` : ''}
</article>
`;
}

const JOURNAL_PAGES = POSTS.length ? [
  {
    slug: 'journal', url: '/journal', nav: 'journal',
    title: 'Journal | Occasions Box',
    desc: 'Notes on gifting well: what to send, when to send it, and how to make '
        + 'it land. From the Occasions Box studio in Fort Lee, New Jersey.',
    header: {
      eyebrow: 'Journal',
      h1: 'Notes on Gifting Well',
      p: 'What to send, when to send it, and how to make it land.',
    },
    sections: [], html: journalIndexBody(), journalIndex: true,
  },
  ...POSTS.map((post) => ({
    slug: `journal/${post.slug}`, url: `/journal/${post.slug}`, nav: 'journal',
    title: post.seoTitle || `${post.title} | Occasions Box`,
    desc: post.summary,
    sections: [], html: postBody(post), post,
  })),
] : [];

const navFor = (page) => {
  const mark = (which) => (page.nav === which ? ' class="active"' : '');
  return NAV
    .replaceAll('{{NAV_SCROLLED}}', page.nav === 'home' ? '' : ' scrolled')
    .replaceAll('{{A_SHOP}}', mark('shop'))
    .replaceAll('{{A_CUSTOM}}', mark('custom-gifting'))
    .replaceAll('{{A_CONCIERGE}}', mark('concierge'))
    .replaceAll('{{A_ABOUT}}', mark('about'))
    .replaceAll('{{A_CONTACT}}', mark('contact'))
    /* The journal is only in the nav once there is something to read. */
    .replaceAll('{{JOURNAL_NAV}}', POSTS.length
      ? `\n    <a href="/journal"${mark('journal')}>Journal</a>` : '')
    .replaceAll('{{JOURNAL_MOBILE}}', POSTS.length
      ? '\n  <a href="/journal" onclick="toggleMobile()">Journal</a>' : '');
};

const headerFor = (page) => page.header
  ? `\n<!-- ═══ PAGE HEADER ═══ -->\n<header class="page-header">\n` +
    `  <p class="eyebrow">${page.header.eyebrow}</p>\n` +
    `  <h1>${page.header.h1}</h1>\n` +
    `  <p>${page.header.p}</p>\n</header>\n`
  : '';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function render(page) {
  const canonical = SITE + page.url;
  const [ogImage, ogAlt] = ogFor(page);
  const body = page.html || page.sections.map(section).join('\n\n');
  const extras = [page.modal ? MODAL : '', page.cart ? CART : '', WIDGETS].filter(Boolean).join('\n\n');
  const FOOTER = FOOTER_RAW.replace('{{JOURNAL_LINK}}',
    POSTS.length ? '\n      <a href="/journal">Journal</a>' : '');
  const paypal = page.paypal
    ? '\n<!-- The PayPal client id is a public value: it identifies the merchant to\n' +
      '     PayPal and ships in the page source by design. The Secret is a separate\n' +
      '     credential and is never in this repo or on this page.\n' +
      '     enable-funding=venmo puts the Venmo button beside PayPal for eligible US\n' +
      '     buyers. -->\n' +
      `<script src="https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture&enable-funding=venmo" data-namespace="paypalSDK"></script>\n`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.desc)}">
<meta property="og:type" content="${page.post ? 'article' : 'website'}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="Occasions Box">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="${SITE}${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.desc)}">
<meta name="twitter:image" content="${SITE}${ogImage}">
<meta name="twitter:image:alt" content="${esc(ogAlt)}">
<script type="application/ld+json">
${JSON.stringify(ldGraph(page), null, 2)}
</script>
<link rel="icon" type="image/png" href="/assets/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/site.css">
<script>
  /* Mark that JS is live so scroll-reveal content may start hidden, with a
     failsafe that reveals it if the animation library never arrives. */
  document.documentElement.className += ' anim';
  window.__animFailsafe = setTimeout(function () {
    document.documentElement.classList.remove('anim');
  }, 2500);
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
</head>
<body class="${page.nav === 'home' ? 'home' : `page-${page.slug.replace('/', '-')}`}">

${navFor(page)}
${headerFor(page)}
${body}

${FOOTER}

${extras}
${paypal}
<script src="/assets/js/site.js"></script>

</body>
</html>
`;
}

/** An unclosed <!-- swallows the rest of the document, including the script
 *  tag. Cheap to check, invisible in a browser until something silently dies. */
function assertCommentsBalanced(slug, html) {
  const open = (html.match(/<!--/g) || []).length;
  const close = (html.match(/-->/g) || []).length;
  if (open !== close) {
    throw new Error(`${slug}: unbalanced HTML comments (${open} open, ${close} close)`);
  }
}

/* Sarah reads the em dash as a tell that a machine wrote the copy, and does
   not want one anywhere on the site. The rule outlives this build, so the
   build holds it: an em dash in a page, however it got there, stops the build
   and names the page. En dashes are untouched; they are ranges (2-4 weeks)
   and they are correct. To lift the rule, delete this function and its two
   calls. */
function assertNoEmDash(what, text) {
  const i = text.indexOf('\u2014');
  if (i !== -1) {
    const near = text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ');
    throw new Error(`${what}: em dash in the copy. Use the mark the sentence `
      + `wants: a semicolon between two halves that each stand alone, a colon `
      + `before a list, otherwise a comma.\n  ...${near}...`);
  }
}

/* The storefront's product copy and the stylesheet are not built from here,
   so they are checked directly rather than through a page. */
for (const f of ['site/assets/js/site.js', 'site/assets/css/site.css']) {
  const text = read(f);
  assertNoEmDash(f, text);
  /* \u2014 in a JS string renders as an em dash just the same. */
  if (/\\u2014/.test(text)) throw new Error(`${f}: escaped em dash (\\u2014) in the copy.`);
}

mkdirSync(join(ROOT, 'site/shop'), { recursive: true });
if (POSTS.length) mkdirSync(join(ROOT, 'site/journal'), { recursive: true });

let n = 0;
for (const page of [...PAGES, ...PRODUCT_PAGES, ...JOURNAL_PAGES]) {
  const out = `site/${page.slug}.html`;
  const html = render(page);
  assertCommentsBalanced(page.slug, html);
  assertNoEmDash(out, html);
  writeFileSync(join(ROOT, out), html, 'utf8');
  console.log(`${out.padEnd(34)} ${page.url.padEnd(26)} ${page.product ? 'product' : page.post ? 'journal post' : page.journalIndex ? 'journal index' : page.sections.join(', ')}`);
  n++;
}
console.log(`\n${n} pages written.`);

/* ── Crawler files ──────────────────────────────────────────────────────────
   Both are generated from PAGES so a new page cannot be added to the site and
   forgotten by the sitemap. lastmod comes from the section files a page is
   built from, which is the closest honest answer to "when did this page last
   change"; a sitemap that claims today's date on every page is noise Google
   learns to ignore. */
const lastModified = (page) => {
  const files = page.sections.length ? page.sections.map((s) => `tools/sections/${s}.html`)
    : page.post ? [`tools/posts/${page.post.slug}.html`]
    : page.journalIndex ? POSTS.map((o) => `tools/posts/${o.slug}.html`)
    : ['site/assets/js/site.js'];
  const dates = files.map((file) => {
    /* A fresh clone stamps every file with the checkout time, which would put
       today's date on all eight pages forever. Git knows when the content
       actually changed; fall back to the mtime only if git is unavailable. */
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file],
        { cwd: ROOT, encoding: 'utf8' }).trim();
      if (out) return out.slice(0, 10);
    } catch { /* not a git checkout */ }
    return new Date(statSync(join(ROOT, file)).mtime).toISOString().slice(0, 10);
  });
  return dates.sort().at(-1);
};

/* The home page is what we most want crawled; policy pages least. */
const PRIORITY = { index: '1.0', shop: '0.9', 'custom-gifting': '0.9', concierge: '0.8',
                   about: '0.7', contact: '0.7' };
const priorityFor = (page) => (page.product ? '0.8' : page.post ? '0.6'
  : page.journalIndex ? '0.7' : PRIORITY[page.slug] || '0.3');
const SITEMAP_PAGES = [...PAGES, ...PRODUCT_PAGES, ...JOURNAL_PAGES];

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...SITEMAP_PAGES.map((page) => [
    '  <url>',
    `    <loc>${SITE}${page.url}</loc>`,
    `    <lastmod>${lastModified(page)}</lastmod>`,
    `    <priority>${priorityFor(page)}</priority>`,
    '  </url>',
  ].join('\n')),
  '</urlset>',
  '',
].join('\n');
writeFileSync(join(ROOT, 'site/sitemap.xml'), sitemap, 'utf8');
console.log(`site/sitemap.xml${' '.repeat(18)} ${SITEMAP_PAGES.length} urls`);

/* /admin is the CRM behind a rewrite. It is not secret, but it is not ours to
   put in front of a searcher, and crawling it just burns budget. */
const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/

Sitemap: ${SITE}/sitemap.xml
`;
writeFileSync(join(ROOT, 'site/robots.txt'), robots, 'utf8');
console.log('site/robots.txt');
