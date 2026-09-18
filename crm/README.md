# OccasionsBox CRM

Internal CRM for [OccasionsBox](https://occasionsbox.com) — elevated corporate
and closing gifting. Built with Next.js 15 (App Router), Supabase and
TypeScript, derived from the VioX CRM template.

The CRM lives in the `crm/` folder of the `ob-cinematic` monorepo and is served
under the `/admin` base path:

| How it is reached | URL |
| --- | --- |
| Directly (Vercel project `ob-crm`) | `https://ob-crm-vio-x-bergsify.vercel.app/admin` |
| Through the marketing site (rewrite in the repo-root `vercel.json`) | `https://occasionsbox.com/admin` |

Both hosts hit the same deployment, so every server-side redirect is
host-agnostic (relative `Location` headers that include the base path).

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run `supabase/setup-all.sql` — it is all six
   migrations concatenated in the right order, so one paste is enough on a new
   project. To apply them one at a time instead (see `supabase/README.md`):
   1. `supabase/migrations/001_initial_schema.sql`
   2. `supabase/migrations/002_org_branding_superadmin_v2.sql`
   3. `supabase/migrations/003_email_templates.sql`
   4. `supabase/migrations/004_custom_fields.sql`
   5. `supabase/migrations/005_notifications.sql`
   6. `supabase/migrations/006_occasionsbox.sql`
   7. `supabase/migrations/007_catalogue_occasions_proposals.sql`
   8. `supabase/seed/occasionsbox_catalogue.sql`
3. Copy the Project URL, anon key and service role key from
   **Settings → API**.

### 2. Vercel project `ob-crm`

1. Import the `ob-cinematic` repository as a new Vercel project named
   `ob-crm`.
2. Set **Root Directory** to `crm`. (`crm/vercel.json` skips builds for
   commits that do not touch `crm/`.)
3. Paste the environment variables from `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SITE_API_KEY`, and optionally
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALLOWED_ORIGINS`,
   `NEXT_PUBLIC_APP_URL`.
4. Deploy. The build succeeds even before the variables are pasted; until
   they exist the app serves a "not configured yet" page.

### 3. Supabase Auth URL configuration

In Supabase **Authentication → URL Configuration**:

- **Site URL:** `https://ob-crm-vio-x-bergsify.vercel.app/admin`
- **Redirect URLs:**
  - `https://ob-crm-vio-x-bergsify.vercel.app/admin/auth/callback`
  - `https://occasionsbox.com/admin/auth/callback`
  - `http://localhost:3000/admin/auth/callback` (local development)

### 4. First account and team

Either let Sarah sign up and invite Kari, or create both accounts in one go:

```bash
cd crm
cp .env.example .env.local     # fill in the Supabase values
npm run team:bootstrap         # invites Sarah (owner) and Kari (admin)
```

`scripts/bootstrap-team.mjs` creates the organisation and the pipeline, then
sends each person a Supabase invite so they set their own password. Nobody's
password is ever typed into the repo. Change who is on the team by passing
them as arguments:

```bash
node scripts/bootstrap-team.mjs sarah@occasionsbox.com:owner:"Sarah De Jesus" \
                                kari@occasionsbox.com:admin:"Kari Aragon"
```

Only one person can be the `owner`; the database enforces it. Re-running is
safe, and `--update-roles` is needed to change an existing person's role.

By hand instead:

1. Visit `/admin/signup` and create the first account. The **first signup
   becomes the owner** and creates the `occasionsbox` organisation with the
   default deal stages from `src/crm.config.ts`.
2. Accounts are invite-only after that. Invite teammates from
   **Settings → Team** (roles: `admin`, `member`). Invited users receive an
   email that lands on `/admin/auth/callback`.
3. **Turn off public sign-ups** once the owner account exists: Supabase
   dashboard → Authentication → Providers → Email → disable
   **Enable Sign Ups** (or Authentication → Settings → "Allow new users to
   sign up"). The CRM refuses a profile for uninvited accounts, but the auth
   user itself would otherwise still be created; invites keep working with
   sign-ups disabled.
4. Optional but recommended: set `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` (and
   `PAYPAL_ENV=live` when the site switches from `client-id=sb`) so website
   orders are verified against PayPal before they are recorded as paid.
   Without them, orders reported by the website are filed as
   "Unverified order: …" in the first pipeline stage.

## Local development

```bash
cd crm
npm install
cp .env.example .env.local   # fill in the Supabase values (or run scripts/setup.sh)
npm run dev                  # http://localhost:3000/admin
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (type errors fail the build) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Configuration

`src/crm.config.ts` is the single business config: name, contact details,
branding colours and fonts, default deal stages (Inquiry → Quote Sent →
Approved → Fulfillment → Delivered / Lost), and feature flags.

`src/lib/url.ts` exposes the base path helpers. Next.js prefixes `<Link>`,
`router.push()` and `redirect()` automatically, but **not** `fetch('/api/…')`
or raw `Location` headers, so use:

- `withBasePath('/api/v1/…')` for fetch URLs and raw redirects
- `publicUrl('/auth/callback')` for absolute browser URLs (Supabase
  `emailRedirectTo`)

## Ingest API

The marketing site posts to the CRM through the same-origin `/admin` rewrite,
with no key in the page. Requests are authorised either by the `x-api-key`
header (`SITE_API_KEY`, for server-to-server callers such as the voice agent)
or by an allow-listed browser `Origin`.

| Endpoint | Used by |
| --- | --- |
| `POST /admin/api/v1/ingest/lead` | Contact form |
| `POST /admin/api/v1/ingest/newsletter` | Newsletter signup |
| `POST /admin/api/v1/ingest/order` | PayPal order capture (cart: `items[{name, unitAmount, quantity}]`) |
| `POST /admin/api/v1/ingest/booking` | Booking requests |
| `POST /admin/api/v1/ingest/voice-call` | AI voice agent call logs |

All other `/api/*` routes require a signed-in Supabase session.

## Architecture

```
crm/
  next.config.ts           # basePath /admin, NEXT_PUBLIC_BASE_PATH
  vercel.json              # skip builds when crm/ is unchanged
  src/
    crm.config.ts          # business config (single source of truth)
    middleware.ts          # auth gate, 503 when Supabase env is missing
    lib/url.ts             # BASE_PATH, withBasePath(), publicUrl()
    lib/ingest.ts          # ingest auth (API key / origin), org lookup
    app/
      (app)/               # CRM dashboard (session required)
      (auth)/              # Login / signup
      (portal)/            # Client-facing portal
      auth/callback/       # Supabase OAuth / magic-link callback
      api/v1/ingest/       # Public ingest endpoints
      api/v1/...           # Session-protected API routes
    components/            # Shared UI
    types/                 # TypeScript interfaces
  supabase/migrations/     # Database schema (apply in order)
  scripts/setup.sh         # Local .env.local wizard
```

## Features

- **Dashboard** — revenue charts, pipeline snapshot, activity feed
- **Contacts & Companies** — merge, import, export
- **Deal Pipeline** — Kanban board with drag-and-drop
- **Leads** — source attribution and conversion
- **Calendar** — activities and tasks
- **Email** — templates, compose and send (via Resend)
- **Invoices** — line items, PDF export
- **Automations** — workflow triggers and actions
- **Client Portal** — branded portal for clients
- **Reports** — revenue, pipeline, activity and source analytics


## What the CRM runs on

`supabase/migrations/007_catalogue_occasions_proposals.sql` turns the CRM from
a contact list into the place the business is run from:

| Table | What it holds |
| --- | --- |
| `products` (extended) | The catalogue: every gift box, corporate tier, concierge plan, add-on and service, with its SKU, price, photograph, contents, cost and stock |
| `inventory_items`, `product_components` | What is inside each box, as countable stock with a bill of materials, so "are we short of the gold matches?" has an answer |
| `inventory_movements` | Every stock change with a reason and an audit trail. A trigger keeps the counts in step; stock is never edited directly |
| `occasions` | The gifting calendar: 27 occasions with the date rule (fixed, nth weekday, last full week), the lead time, talking points and suggested boxes |
| `client_occasions` | The dates we are holding for each client, with status from planned to delivered |
| `proposals`, `proposal_items` | Quotes, with a public token so a client can read and approve one from a link |
| `orders`, `order_items` | Every purchase: the website cart, and later an accepted proposal. Line items link back to the catalogue and take stock off the shelf |
| `document_counters` | Sequential proposal and order numbers that stay unique under concurrent writes |

### The catalogue is generated, not typed

`scripts/build-seed.mjs` reads `site/assets/js/site.js` and `site/shop.html`,
the marketing site's own catalogue, and writes
`supabase/seed/occasionsbox_catalogue.sql`: 21 boxes with their real prices,
photographs, contents and occasion tags, plus the tiers, plans, add-ons, 91
inventory components with a 158-line bill of materials, the gifting calendar
and six outreach email templates.

```bash
npm run sql:bundle     # regenerate the seed AND supabase/setup-all.sql
```

Re-running the seed against a live database refreshes names, prices, contents
and photographs, and never touches stock, costs, reorder points or whether
something is active. Change a price on the website, run this, and the CRM
agrees with the shop again.

## The voice agent (Olivia)

Olivia is an ElevenLabs agent on the phone number `(551) 246-0028` and in the
widget on the marketing site. She reaches the CRM through five webhook tools,
each authenticated with `SITE_API_KEY` as the `x-api-key` header:

| Tool | Endpoint | What it does |
| --- | --- | --- |
| `search_catalogue` | `POST /admin/api/v1/agent/catalogue` | Ranked catalogue search, so she quotes real boxes at real prices |
| `find_customer` | `POST /admin/api/v1/agent/customer` | Recognises a caller by phone or email, with their orders, open deals and upcoming dates |
| `create_opportunity` | `POST /admin/api/v1/agent/opportunity` | Contact + deal + follow-up task + a date on the gifting calendar |
| `request_callback` | `POST /admin/api/v1/agent/callback` | A call task at the time the caller asked for |
| `upcoming_occasions` | `POST /admin/api/v1/agent/occasions` | What is coming up and the approve-by date for each |

Unlike the ingest routes, the agent routes never accept an `Origin` as
authorisation: they read and write customer data, so only a caller holding the
API key gets in.

Every conversation is filed in the CRM by the post-call webhook at
`POST /admin/api/v1/elevenlabs/post-call`, verified against
`ELEVENLABS_WEBHOOK_SECRET` (HMAC-SHA256 over `<timestamp>.<body>`, 30 minute
window) and idempotent on the conversation id. Configure it in the ElevenLabs
dashboard under Settings → Webhooks → Post-call.

Olivia's knowledge base is kept in `tools/elevenlabs/olivia-knowledge-base.txt`
at the repository root. It is generated from the live catalogue; when prices or
boxes change, regenerate it and paste it into the ElevenLabs knowledge base
document.

## Proposals

A proposal is drafted at `/admin/proposals/new`, optionally from a date on the
gifting calendar, and carries catalogue line items, a discount, shipping, tax
and the standard terms. Sending it emails the client a link to
`/admin/p/<token>`, where they read it and press Approve. That token is 48 hex
characters generated by the database and is the only credential, exactly like a
PDF in an inbox: it reveals nothing else, and the route never accepts an id.

An approval writes back: the proposal is marked accepted, the calendar date
moves to approved, and an urgent task appears for the team to start sourcing.
The first open is recorded too, so the team can tell "not read yet" from
"read and thinking about it".
