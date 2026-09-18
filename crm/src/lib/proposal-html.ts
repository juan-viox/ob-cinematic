import crmConfig from '@/crm.config'
import type { Proposal, ProposalItem } from '@/types'

/**
 * The proposal as the client sees it: one self-contained HTML document,
 * used both for the print view and the public page. It carries no scripts
 * and no external assets beyond the web font, so it prints the same way it
 * reads and works in an email client's preview.
 */

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Colours are interpolated into CSS, so only hex literals are allowed. */
function cssColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback
}

const fmtMoney = (n: unknown) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(n) || 0)

const fmtDate = (d: unknown) => {
  if (!d) return ''
  const dt = new Date(String(d).length <= 10 ? `${d}T12:00:00` : String(d))
  if (Number.isNaN(dt.getTime())) return esc(d)
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(dt)
}

const paragraphs = (text: string) =>
  esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')

export interface ProposalDocOptions {
  /** Renders the approve / decline form on the public page. */
  acceptAction?: string
  /** A note above the buttons, e.g. after an approval. */
  banner?: { tone: 'success' | 'muted'; text: string }
  /** Adds the print / close toolbar. */
  printToolbar?: boolean
}

export function renderProposalHtml(
  proposal: Proposal,
  items: ProposalItem[],
  opts: ProposalDocOptions = {}
): string {
  const biz = crmConfig
  const primary = cssColor(biz.branding.primaryColor, '#2C3E50')
  const accent = cssColor(biz.branding.accentColor, '#B8860B')
  const contact = proposal.contact
  const clientName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : ''
  const clientCompany = contact?.company?.name ?? proposal.company?.name ?? ''
  const decided = proposal.status === 'accepted' || proposal.status === 'declined'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(proposal.proposal_number)} · ${esc(biz.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --primary:${primary}; --accent:${accent}; --ink:#22222a; --muted:#6b6b76; --line:#e7e5e0; --paper:#fdfcfa; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Outfit',-apple-system,system-ui,sans-serif; color:var(--ink); background:var(--paper);
         line-height:1.6; padding:32px 16px 64px; -webkit-font-smoothing:antialiased; }
  .sheet { max-width:760px; margin:0 auto; background:#fff; border:1px solid var(--line);
           border-radius:14px; padding:48px; box-shadow:0 12px 40px rgba(0,0,0,0.05); }
  .brand { font-family:'Cormorant Garamond',Georgia,serif; font-size:30px; font-weight:600;
           letter-spacing:0.01em; color:var(--primary); }
  .tagline { font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent); margin-top:4px; }
  header { display:flex; justify-content:space-between; align-items:flex-start; gap:24px;
           flex-wrap:wrap; padding-bottom:24px; border-bottom:2px solid var(--primary); }
  .docmeta { text-align:right; font-size:13px; color:var(--muted); }
  .docmeta strong { display:block; font-size:22px; color:var(--primary); font-weight:600; letter-spacing:0.04em; }
  h1 { font-family:'Cormorant Garamond',Georgia,serif; font-size:30px; font-weight:600; margin:32px 0 6px; }
  .who { display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; margin:24px 0 32px; font-size:14px; }
  .label { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
  .intro p { margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; margin:28px 0 0; font-size:14px; }
  thead th { text-align:left; font-size:10px; letter-spacing:0.12em; text-transform:uppercase;
             color:var(--muted); border-bottom:1px solid var(--line); padding:0 0 10px; font-weight:600; }
  thead th.num, tbody td.num { text-align:right; }
  tbody td { padding:14px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody td .detail { font-size:12.5px; color:var(--muted); margin-top:3px; }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  .totals { margin:24px 0 0 auto; max-width:300px; font-size:14px; }
  .totals div { display:flex; justify-content:space-between; padding:6px 0; color:var(--muted); }
  .totals .grand { border-top:2px solid var(--primary); margin-top:8px; padding-top:14px;
                   font-size:20px; font-weight:600; color:var(--primary); }
  .section { margin-top:36px; padding-top:24px; border-top:1px solid var(--line); }
  .section p { font-size:13.5px; color:var(--muted); margin-bottom:10px; }
  .accept { margin-top:36px; padding:28px; border-radius:12px; background:#faf8f4; border:1px solid var(--line); }
  .accept h2 { font-family:'Cormorant Garamond',Georgia,serif; font-size:22px; font-weight:600; margin-bottom:8px; }
  .accept p { font-size:13.5px; color:var(--muted); margin-bottom:16px; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:12px; color:var(--muted); margin-bottom:5px; }
  .field input, .field textarea { width:100%; padding:11px 13px; border:1px solid var(--line);
    border-radius:8px; font:inherit; font-size:14px; background:#fff; color:var(--ink); }
  .field input:focus, .field textarea:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:var(--accent); }
  .actions { display:flex; gap:12px; flex-wrap:wrap; margin-top:4px; }
  button { font:inherit; font-size:14px; font-weight:500; padding:12px 26px; border-radius:999px;
           border:1px solid transparent; cursor:pointer; }
  .approve { background:var(--primary); color:#fff; }
  .approve:hover { background:#1d2b38; }
  .decline { background:#fff; color:var(--muted); border-color:var(--line); }
  .banner { margin-top:28px; padding:18px 22px; border-radius:10px; font-size:14px; }
  .banner.success { background:rgba(34,139,34,0.08); color:#1c6b1c; border:1px solid rgba(34,139,34,0.2); }
  .banner.muted { background:#f4f3f0; color:var(--muted); border:1px solid var(--line); }
  footer { max-width:760px; margin:24px auto 0; text-align:center; font-size:12px; color:var(--muted); }
  footer a { color:var(--muted); }
  .toolbar { position:fixed; top:16px; right:16px; display:flex; gap:8px; }
  .toolbar button { padding:9px 18px; font-size:13px; }
  @media print {
    body { padding:0; background:#fff; }
    .sheet { border:0; box-shadow:none; padding:0; max-width:none; }
    .toolbar, .accept { display:none; }
  }
  @media (max-width:600px) {
    body { padding:16px 16px 48px; }
    .sheet { padding:28px 20px; }
    .docmeta { text-align:left; }
  }
</style>
</head>
<body>
${opts.printToolbar ? `<div class="toolbar">
  <button class="approve" onclick="window.print()">Print or save as PDF</button>
  <button class="decline" onclick="window.close()">Close</button>
</div>` : ''}
<div class="sheet">
  <header>
    <div>
      <div class="brand">${esc(biz.name)}</div>
      <div class="tagline">${esc(biz.tagline)}</div>
    </div>
    <div class="docmeta">
      <strong>${esc(proposal.proposal_number)}</strong>
      ${esc(fmtDate(proposal.issue_date))}<br>
      ${proposal.valid_until ? `Valid until ${esc(fmtDate(proposal.valid_until))}` : ''}
    </div>
  </header>

  <h1>${esc(proposal.title)}</h1>

  <div class="who">
    <div>
      <div class="label">Prepared for</div>
      ${clientName ? `<strong>${esc(clientName)}</strong><br>` : ''}
      ${clientCompany ? `${esc(clientCompany)}<br>` : ''}
      ${contact?.email ? `${esc(contact.email)}` : ''}
    </div>
    <div style="text-align:right">
      <div class="label">From</div>
      ${esc(biz.name)}<br>
      ${esc(biz.address)}<br>
      ${esc(biz.phone)} · ${esc(biz.email)}
    </div>
  </div>

  ${proposal.intro ? `<div class="intro">${paragraphs(proposal.intro)}</div>` : ''}

  <table>
    <thead>
      <tr><th>Item</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Total</th></tr>
    </thead>
    <tbody>
      ${items
        .map(
          (i) => `<tr>
        <td><strong>${esc(i.description)}</strong>${i.details ? `<div class="detail">${esc(i.details)}</div>` : ''}</td>
        <td class="num">${esc(i.quantity)}</td>
        <td class="num">${esc(fmtMoney(i.unit_price))}</td>
        <td class="num"><strong>${esc(fmtMoney(i.total))}</strong></td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span class="num">${esc(fmtMoney(proposal.subtotal))}</span></div>
    ${Number(proposal.discount_amount) > 0 ? `<div><span>Discount</span><span class="num">&minus;${esc(fmtMoney(proposal.discount_amount))}</span></div>` : ''}
    ${Number(proposal.shipping_amount) > 0 ? `<div><span>Shipping &amp; delivery</span><span class="num">${esc(fmtMoney(proposal.shipping_amount))}</span></div>` : ''}
    ${Number(proposal.tax_rate) > 0 ? `<div><span>Tax (${esc(proposal.tax_rate)}%)</span><span class="num">${esc(fmtMoney(proposal.tax_amount))}</span></div>` : ''}
    <div class="grand"><span>Total</span><span class="num">${esc(fmtMoney(proposal.total))}</span></div>
  </div>

  ${proposal.needed_by ? `<div class="section"><div class="label">Needed by</div><p>${esc(fmtDate(proposal.needed_by))}. Our standard lead time is two to four weeks from approval, three to four for anything shipping between 15 October and 31 December, plus one to seven business days in transit.</p></div>` : ''}

  ${proposal.notes ? `<div class="section"><div class="label">Notes</div>${paragraphs(proposal.notes)}</div>` : ''}
  ${proposal.terms ? `<div class="section"><div class="label">Terms</div>${paragraphs(proposal.terms)}</div>` : ''}

  ${opts.banner ? `<div class="banner ${opts.banner.tone}">${esc(opts.banner.text)}</div>` : ''}

  ${
    opts.acceptAction && !decided
      ? `<form class="accept" method="POST" action="${esc(opts.acceptAction)}">
    <h2>Ready to go ahead?</h2>
    <p>Approving here tells us to start sourcing. We will confirm your ship date in writing the same day.</p>
    <div class="field">
      <label for="name">Your name</label>
      <input id="name" name="name" required autocomplete="name" value="${esc(clientName)}">
    </div>
    <div class="field">
      <label for="note">Anything to change or add? (optional)</label>
      <textarea id="note" name="note" rows="3"></textarea>
    </div>
    <div class="actions">
      <button class="approve" type="submit" name="decision" value="accept">Approve this proposal</button>
      <button class="decline" type="submit" name="decision" value="decline">Not this time</button>
    </div>
  </form>`
      : ''
  }
</div>
<footer>
  ${esc(biz.name)} · ${esc(biz.address)} · <a href="tel:${esc(biz.phone.replace(/[^\d+]/g, ''))}">${esc(biz.phone)}</a> · <a href="mailto:${esc(biz.email)}">${esc(biz.email)}</a>
</footer>
</body>
</html>`
}
