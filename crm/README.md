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
| `POST /admin/api/v1/ingest/order` | PayPal order capture |
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
