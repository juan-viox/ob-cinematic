# OccasionsBox

Monorepo for the OccasionsBox marketing site and its CRM.

| Folder | What | Vercel project | Root directory |
| --- | --- | --- | --- |
| `site/` | Static marketing site (`site/index.html` + `site/assets`) | `ob-cinematic` | repo root (`vercel.json` here) |
| `crm/` | OccasionsBox CRM, Next.js 15 + Supabase, cloned from the viox-crm template, mounted at `/admin` | `ob-crm` | `crm` |

## How the two fit together

- The CRM builds with `basePath: '/admin'` and is served directly at `https://ob-crm-vio-x-bergsify.vercel.app/admin`.
- The root `vercel.json` rewrites `/admin` and `/admin/*` on the marketing site to that URL, so once DNS points `occasionsbox.com` at the `ob-cinematic` project, the CRM is reachable at `https://occasionsbox.com/admin` and the site's forms post to `/admin/api/v1/ingest/*` on the same origin.
- The voice agent (ElevenLabs) posts leads server-to-server to `/admin/api/v1/ingest/lead` with the `x-api-key` header (`SITE_API_KEY`).

Each Vercel project uses an `ignoreCommand` so a push that only touches one folder only builds that project.

## Working locally

```bash
# marketing site
python3 -m http.server 3456 --directory site

# CRM
cd crm && cp .env.example .env.local   # fill in Supabase values
npm install && npm run dev             # http://localhost:3000/admin
```

See `crm/README.md` for the CRM setup (Supabase migrations, environment variables, first owner account).

## Launch checklist

1. Create the Vercel project `ob-crm` from this repo with Root Directory `crm`, paste the environment variables, set Deployment Protection to previews only.
2. Run `crm/supabase/migrations` in order on a fresh Supabase project; add the auth redirect URLs listed in `crm/README.md`.
3. Sign up the first owner account at `/admin/signup`, then invite the team.
4. Run the `Localize Squarespace images` GitHub Action once so the site no longer depends on the Squarespace CDN.
5. Replace the PayPal sandbox client id in `site/index.html`.
6. Point DNS at Vercel and remove the `X-Robots-Tag: noindex` header from `vercel.json`.
