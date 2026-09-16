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
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\s+$/, '');
const partial = (n) => read(`tools/partials/${n}.html`);
const section = (n) => read(`tools/sections/${n}.html`);

const SITE = 'https://www.occasionsbox.com';

const NAV = partial('nav');
const FOOTER = partial('footer');
const MODAL = partial('modal');
const WIDGETS = partial('widgets');

/** slug → output file; url → canonical path; nav → which nav item is current */
const PAGES = [
  {
    slug: 'index', url: '/', nav: 'home',
    title: 'Occasions Box — Custom Gifting, Thoughtfully Executed',
    desc: 'Luxury custom gift curation and concierge gifting for corporate events, weddings and milestones. Now booking Holiday 2026.',
    sections: ['hero', 'mask', 'marquee', 'products', 'testimonials', 'clients', 'newsletter'],
  },
  {
    slug: 'shop', url: '/shop', nav: 'shop',
    title: 'Shop All Boxes — Occasions Box',
    desc: 'Browse our ready-to-ship curated gift boxes. Every box is hand-packed, gift-wrapped and sent with a handwritten note.',
    header: {
      eyebrow: 'Collections',
      h1: 'Shop All Boxes',
      p: 'Ready-to-ship gift boxes, hand-packed and finished with ribbon and a handwritten note. Need something bespoke? We build those too.',
    },
    sections: ['products', 'shop'],
    modal: true, paypal: true,
  },
  {
    slug: 'custom-gifting', url: '/custom-gifting', nav: 'custom-gifting',
    title: 'Business + Custom Gifting — Occasions Box',
    desc: 'Corporate and custom gifting concierge. Volume pricing, bespoke curation and full white-glove fulfilment for clients, teams and events.',
    header: {
      eyebrow: 'Business + Custom Gifting',
      h1: 'Gifting, Handled End to End',
      p: 'We partner with you to create elevated, custom gift experiences for clients, teams and milestones — concept to delivery, handled by our concierge.',
    },
    sections: ['howitworks', 'pricing', 'concierge'],
  },
  {
    slug: 'about', url: '/about', nav: 'about',
    title: 'About Us — Occasions Box',
    desc: 'Occasions Box curates elevated, deeply personal gifts. Learn how we work and who we build for.',
    header: {
      eyebrow: 'About Us',
      h1: 'Gifting Should Feel Effortless',
      p: 'Every box is thoughtfully curated with high-quality items, beautifully packaged and ready to gift — so you can mark the moments that matter without the stress.',
    },
    sections: ['about', 'clients'],
  },
  {
    slug: 'contact', url: '/contact', nav: 'contact',
    title: 'Contact — Occasions Box',
    desc: 'Start a custom gift, request corporate pricing, or ask us anything. We reply within one business day.',
    header: {
      eyebrow: 'Get in Touch',
      h1: 'Start Your Gift',
      p: 'Tell us about the occasion, the recipients and the timeline. We reply within one business day.',
    },
    sections: ['contact', 'newsletter'],
  },
];

const navFor = (page) => {
  const mark = (which) => (page.nav === which ? ' class="active"' : '');
  return NAV
    .replaceAll('{{NAV_SCROLLED}}', page.nav === 'home' ? '' : ' scrolled')
    .replaceAll('{{A_SHOP}}', mark('shop'))
    .replaceAll('{{A_CUSTOM}}', mark('custom-gifting'))
    .replaceAll('{{A_ABOUT}}', mark('about'))
    .replaceAll('{{A_CONTACT}}', mark('contact'));
};

const headerFor = (page) => page.header
  ? `\n<!-- ═══ PAGE HEADER ═══ -->\n<header class="page-header">\n` +
    `  <p class="eyebrow">${page.header.eyebrow}</p>\n` +
    `  <h1>${page.header.h1}</h1>\n` +
    `  <p>${page.header.p}</p>\n</header>\n`
  : '';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function render(page) {
  const canonical = SITE + page.url;
  const body = page.sections.map(section).join('\n\n');
  const extras = [page.modal ? MODAL : '', WIDGETS].filter(Boolean).join('\n\n');
  const paypal = page.paypal
    ? '\n<!-- SANDBOX — replace client-id=sb with the live PayPal client ID before launch -->\n' +
      '<script src="https://www.paypal.com/sdk/js?client-id=sb&currency=USD&intent=capture" data-namespace="paypalSDK"></script>\n'
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
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/assets/hero-holiday-2026.jpg">
<meta name="twitter:card" content="summary_large_image">
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
<body${page.nav === 'home' ? ' class="home"' : ''}>

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

let n = 0;
for (const page of PAGES) {
  const out = `site/${page.slug}.html`;
  writeFileSync(join(ROOT, out), render(page), 'utf8');
  console.log(`${out.padEnd(28)} ${page.url.padEnd(18)} ${page.sections.join(', ')}`);
  n++;
}
console.log(`\n${n} pages written.`);
