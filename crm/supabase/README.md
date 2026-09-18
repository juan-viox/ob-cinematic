# Supabase schema — OccasionsBox CRM

**Quickest path on a new, empty project:** paste `setup-all.sql` into the
Supabase SQL Editor and run it once. It is the nine migrations below concatenated
in order, so there is nothing to sequence by hand. Do not run it against a
database that already has the CRM schema — section 1 uses plain `CREATE TABLE`
and will stop at the first table that exists. To update an older CRM database,
run only `migrations/006_occasionsbox.sql`, which is idempotent.

The individual migrations, in **this exact order**, if you would rather apply
them one at a time (Dashboard → SQL Editor → New query → paste the file → Run):

| # | File | What it creates |
|---|------|-----------------|
| 1 | `migrations/001_initial_schema.sql` | Multi-tenant core: `organizations`, `profiles`, `companies`, `contacts`, `deal_stages`, `deals`, `activities`, `notes`, `tags`, `entity_tags`, `cinematic_sites`, `documents`, `get_user_org_id()`, RLS for all of them |
| 2 | `migrations/002_org_branding_superadmin_v2.sql` | Branding columns on `organizations`, `super_admins` + `is_super_admin()` (referenced by later policies), `portal_users` |
| 3 | `migrations/003_email_templates.sql` | `email_templates`, `products`, `invoices`, `invoice_items`, `workflows` (+ RLS) |
| 4 | `migrations/004_custom_fields.sql` | `custom_field_definitions`, `custom_field_values` (+ RLS) |
| 5 | `migrations/005_notifications.sql` | `notifications` (+ RLS) |
| 6 | `migrations/006_occasionsbox.sql` | OccasionsBox alignment: role CHECK (owner/admin/member), extra contact sources, `organization_id` auto-fill trigger, `documents` columns + `documents` storage bucket, team-management policies on `profiles`, drops the VioX stage-seed trigger (stages come from `crm.config.ts`) |
| 7 | `migrations/007_catalogue_occasions_proposals.sql` | The catalogue on `products`; `inventory_items`, `product_components`, `inventory_movements`; `occasions` + `client_occasions`; `proposals` + `proposal_items`; `orders` + `order_items`; `document_counters` and `next_document_number()`; deal columns for quantity / needed_by / occasion |
| 8 | `migrations/008_function_hardening.sql` | Pins `search_path` on every function the linter flagged (a mutable one lets a caller shadow an unqualified name inside a `SECURITY DEFINER` body), and takes `next_document_number()` away from `anon` — it writes, so only members and the service role may call it |
| 9 | `migrations/009_rls_initplan_and_indexes.sql` | Rewrites the eight policies that called `auth.uid()` per row as `(SELECT auth.uid())` so the planner evaluates it once per query, and adds `organization_id` indexes on `inventory_movements` and `product_components` |
| 10 | `seed/occasionsbox_catalogue.sql` | The catalogue itself: 21 boxes, 3 tiers, 3 services, 3 concierge plans, 8 add-ons, 91 inventory components with their bill of materials, 27 gifting occasions and 6 outreach email templates |

`006` through `009` and the seed are all idempotent and can be re-run. The seed
refreshes names, prices, contents and photographs and never overwrites stock,
costs, reorder points or `is_active`, so it is safe against a live database.

Both `007` and the seed are generated into `setup-all.sql` by
`npm run sql:bundle`; edit the parts, never `setup-all.sql`.

Files that used to live here and must **not** be applied (deleted from the repo):

- `001_standalone_schema.sql` — single-tenant schema for a different template
  mode; the code uses the multi-tenant `001_initial_schema.sql`.
- `002_org_branding_superadmin.sql` — superseded by `..._v2.sql` (same content
  in idempotent form).

## The live project

Project `wztawjcxezojoqvpxvoa` ("OB-CRM", us-west-2) already has all nine
migrations and the catalogue applied. Nothing here needs running against it
again; the files are the record of what it contains, and re-running any of
`006`–`009` or the seed against it is safe.

## After the migrations

1. **Auth → URL configuration**: Site URL `https://www.occasionsbox.com/admin`,
   with redirect URLs for every host the CRM answers on — `https://www.occasionsbox.com/admin/**`,
   `https://occasionsbox.com/admin/**`, `https://ob-crm-vio-x-bergsify.vercel.app/admin/**`
   and the current preview host. Sign-in links bounce without them.
2. **First sign-up becomes the owner.** `/signup` → `/api/auth/setup` creates the
   `occasionsbox` organization (slug from `crm.config.ts`) and seeds the pipeline
   stages (Inquiry → Quote Sent → Approved → Fulfillment → Delivered / Lost).
   Every later account is invite-only (Settings → Team).
3. The public ingest API (`/api/v1/ingest/*`) writes with the service role, which
   bypasses RLS; it always sets `organization_id` explicitly.

## How the schema maps to the code (audit summary)

Tables referenced by `crm/src` (`.from('…')`): `activities`, `cinematic_sites`,
`companies`, `contacts`, `custom_field_definitions`, `custom_field_values`,
`deal_stages`, `deals`, `documents`, `email_templates`, `entity_tags`,
`invoice_items`, `invoices`, `notes`, `notifications`, `organizations`,
`products`, `profiles`, `tags`, `workflows`, plus the `documents` storage bucket.
All exist after 001–006. Column-level gaps found and how they are handled:

| Code | Schema gap | Resolution |
|------|-----------|------------|
| Client-side inserts into `companies`, `products`, `email_templates`, `workflows`, `custom_field_definitions`, `invoices`, `notes` without `organization_id` | column is NOT NULL + RLS `WITH CHECK` | `*_set_org` BEFORE INSERT trigger in 006 fills it from the caller's profile |
| `FileAttachments` → `documents.contact_id/company_id/deal_id/file_url/file_type` | columns did not exist | added in 006, synced with `entity_type/entity_id/file_path/mime_type` |
| `FileAttachments` → storage bucket `documents` | bucket did not exist | created in 006 as **private**; all four storage policies require a `profiles` row, so a portal or self-registered auth user cannot list or download client documents. Downloads go through signed URLs |
| `/contacts/new` sources `cold_call`, `other` | not in `contacts.source` CHECK | CHECK extended in 006 |
| Contacts / Leads tables render `contact.status` (`lead`/`active`/`inactive`) | column did not exist | `contacts.status` added in 006 (default `lead`) |
| Settings → Team updates roles / deletes members | `profiles` only allowed self-update, no DELETE policy | `profiles_admin_update` / `profiles_admin_delete` in 006 |
| `src/types` role union `owner|admin|member` | 002 added `viewer` | CHECK reset to owner/admin/member in 006 |
| `activities.completed` (see below) | column does not exist (`status` / `completed_at` do) | **must be fixed in code** — see "Known code-side issues" |
| `notes.contact_id` update in contact merge | `notes` is polymorphic (`entity_type`/`entity_id`) | **must be fixed in code** |

### Known code-side issues (not solvable in SQL)

- `activities` inserts with `completed: true` in
  `src/app/api/v1/email/send/route.ts`, `src/app/api/v1/workflows/execute/route.ts`
  and `src/app/api/v1/contacts/merge/route.ts` fail with "column completed does not
  exist". Use `status: 'completed', completed_at: <now>` instead.
- `src/app/api/v1/contacts/merge/route.ts` updates `notes.contact_id`; use
  `.eq('entity_type','contact').eq('entity_id', duplicateId)` →
  `{ entity_id: survivorId }` instead.
