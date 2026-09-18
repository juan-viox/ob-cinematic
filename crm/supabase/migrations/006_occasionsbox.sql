-- OccasionsBox CRM — Migration 006: schema/code alignment
-- Run AFTER 001_initial_schema.sql, 002_org_branding_superadmin_v2.sql,
-- 003_email_templates.sql, 004_custom_fields.sql and 005_notifications.sql.
-- Every statement is idempotent: the file can be re-run safely.
--
-- What this fixes (found by auditing every .from('<table>') call in crm/src):
--   1. profiles.role CHECK back to owner/admin/member (002 added 'viewer'; the
--      app, the invite API and src/types only know owner/admin/member).
--   2. contacts.source CHECK gains 'cold_call' and 'other' (/contacts/new offers them);
--      contacts.status (lead/active/inactive) is added — the contacts and leads
--      tables render it.
--   3. organization_id auto-fill: many client-side inserts (companies, products,
--      email_templates, workflows, custom fields, invoices...) omit organization_id
--      although the column is NOT NULL and RLS requires it. A BEFORE INSERT trigger
--      fills it from the caller's profile. Service-role callers (ingest API) still
--      have to pass it explicitly (auth.uid() is NULL there).
--   4. documents: FileAttachments writes contact_id/company_id/deal_id/file_url/
--      file_type; the table only had entity_type/entity_id/file_path/mime_type.
--      Columns are added and kept in sync by a trigger.
--   5. Storage bucket "documents" (PRIVATE; read/write only for CRM members)
--      used by FileAttachments, which serves downloads through signed URLs.
--   6. profiles: owners/admins may change roles of, and remove, members of their
--      own org (Settings → Team). 001 only allowed users to update themselves and
--      had no DELETE policy.
--   7. Deal stages: 001 seeds VioX stages (Lead/Qualified/...) on org insert, which
--      would stop the app from seeding the OccasionsBox pipeline from crm.config.
--      The trigger is dropped (crm.config is the single source of truth) and an
--      untouched VioX default set on the occasionsbox org is replaced.
--   8. RLS check for tables created in 003–005: email_templates, products,
--      invoices, invoice_items, workflows, custom_field_definitions,
--      custom_field_values and notifications all already have RLS enabled with
--      org-scoped policies — nothing to add. The ingest API uses the service role,
--      which bypasses RLS, so no extra policies are needed for it.
--   9. Security hardening: profiles self-update can no longer change role or
--      organization_id (001's policy had no WITH CHECK); profiles_insert is
--      dropped (profiles are only created by the service role); the anon-
--      reachable notifications INSERT policy from 005 is dropped; a single
--      owner per organization is enforced with a partial unique index.

-- ═══════════════════════════════════════════
-- 1. PROFILE ROLES: owner / admin / member only
-- ═══════════════════════════════════════════
UPDATE profiles SET role = 'member' WHERE role NOT IN ('owner', 'admin', 'member');
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- ═══════════════════════════════════════════
-- 2. CONTACT SOURCES used by the UI and the ingest API
-- ═══════════════════════════════════════════
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.contacts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE contacts ADD CONSTRAINT contacts_source_check
  CHECK (source IS NULL OR source IN (
    'manual', 'web_form', 'newsletter', 'voice_agent', 'booking', 'referral', 'import', 'cold_call', 'other'
  ));

-- contacts.status is rendered by the contacts/leads tables (lead / active / inactive)
-- but 001 has no such column.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status text DEFAULT 'lead';
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass AND contype = 'c' AND conname = 'contacts_status_check'
  LOOP
    EXECUTE format('ALTER TABLE public.contacts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE contacts ADD CONSTRAINT contacts_status_check
  CHECK (status IS NULL OR status IN ('lead', 'active', 'inactive'));
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(organization_id, status);

-- ═══════════════════════════════════════════
-- 3. organization_id AUTO-FILL FOR AUTHENTICATED INSERTS
-- ═══════════════════════════════════════════
-- RLS WITH CHECK is evaluated after BEFORE ROW triggers, so the filled value
-- satisfies the existing "organization_id = get_user_org_id()" policies.
CREATE OR REPLACE FUNCTION set_organization_id_default()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := get_user_org_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'contacts', 'deals', 'deal_stages', 'activities', 'notes', 'tags',
    'cinematic_sites', 'documents', 'email_templates', 'products', 'invoices',
    'workflows', 'custom_field_definitions'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'table % missing, skipping organization_id trigger', t;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t || '_set_org' AND tgrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION set_organization_id_default()',
        t || '_set_org', t
      );
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════
-- 4. DOCUMENTS: columns written by FileAttachments
-- ═══════════════════════════════════════════
ALTER TABLE documents ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE documents ALTER COLUMN entity_type DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN entity_id DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN file_path DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_contact ON documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_deal ON documents(deal_id);

-- Keep the polymorphic columns and file_path/mime_type in sync with the new ones
-- so both shapes stay queryable.
CREATE OR REPLACE FUNCTION documents_sync_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entity_type IS NULL OR NEW.entity_id IS NULL THEN
    IF NEW.contact_id IS NOT NULL THEN
      NEW.entity_type := 'contact'; NEW.entity_id := NEW.contact_id;
    ELSIF NEW.company_id IS NOT NULL THEN
      NEW.entity_type := 'company'; NEW.entity_id := NEW.company_id;
    ELSIF NEW.deal_id IS NOT NULL THEN
      NEW.entity_type := 'deal'; NEW.entity_id := NEW.deal_id;
    END IF;
  ELSIF NEW.contact_id IS NULL AND NEW.company_id IS NULL AND NEW.deal_id IS NULL THEN
    IF NEW.entity_type = 'contact' THEN NEW.contact_id := NEW.entity_id;
    ELSIF NEW.entity_type = 'company' THEN NEW.company_id := NEW.entity_id;
    ELSIF NEW.entity_type = 'deal' THEN NEW.deal_id := NEW.entity_id;
    END IF;
  END IF;
  IF NEW.file_path IS NULL THEN NEW.file_path := NEW.file_url; END IF;
  IF NEW.file_url IS NULL THEN NEW.file_url := NEW.file_path; END IF;
  IF NEW.mime_type IS NULL THEN NEW.mime_type := NEW.file_type; END IF;
  IF NEW.file_type IS NULL THEN NEW.file_type := NEW.mime_type; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'documents_sync_columns' AND tgrelid = 'public.documents'::regclass
  ) THEN
    CREATE TRIGGER documents_sync_columns BEFORE INSERT OR UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION documents_sync_columns();
  END IF;
END $$;

-- 001 had no UPDATE policy for documents (contact merge re-parents documents).
DROP POLICY IF EXISTS docs_update ON documents;
CREATE POLICY docs_update ON documents FOR UPDATE
  USING (organization_id = get_user_org_id());

-- ═══════════════════════════════════════════
-- 5. STORAGE BUCKET "documents" (private; FileAttachments uses signed URLs)
-- ═══════════════════════════════════════════
-- The bucket is PRIVATE: nothing in it is reachable with the anon key alone.
-- Every storage policy is gated on CRM membership (a profiles row for the
-- caller) so a self-registered auth user or a portal-login user can neither
-- list, download, overwrite nor delete client documents.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS documents_bucket_select ON storage.objects;
CREATE POLICY documents_bucket_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND get_user_org_id() IS NOT NULL);

DROP POLICY IF EXISTS documents_bucket_insert ON storage.objects;
CREATE POLICY documents_bucket_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND get_user_org_id() IS NOT NULL);

DROP POLICY IF EXISTS documents_bucket_update ON storage.objects;
CREATE POLICY documents_bucket_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND get_user_org_id() IS NOT NULL)
  WITH CHECK (bucket_id = 'documents' AND get_user_org_id() IS NOT NULL);

DROP POLICY IF EXISTS documents_bucket_delete ON storage.objects;
CREATE POLICY documents_bucket_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND get_user_org_id() IS NOT NULL);

-- ═══════════════════════════════════════════
-- 6. TEAM MANAGEMENT: owners/admins manage members of their org
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Change another member's role (never the owner's, never your own via this path;
-- self-updates keep using profiles_update from 001). New role must be admin/member.
-- NOTE: permissive WITH CHECK clauses are OR'd across policies, so this one
-- must repeat the caller/target conditions — otherwise a member could pass
-- USING via profiles_update (own row) and WITH CHECK via this policy.
DROP POLICY IF EXISTS profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('owner', 'admin')
    AND role <> 'owner'
    AND id <> auth.uid()
  )
  WITH CHECK (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('owner', 'admin')
    AND role IN ('admin', 'member')
    AND id <> auth.uid()
  );

-- Remove a member (not the owner, not yourself) from the org.
DROP POLICY IF EXISTS profiles_admin_delete ON profiles;
CREATE POLICY profiles_admin_delete ON profiles FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('owner', 'admin')
    AND role <> 'owner'
    AND id <> auth.uid()
  );

-- ═══════════════════════════════════════════
-- 7. DEAL STAGES come from crm.config, not from the 001 seed trigger
-- ═══════════════════════════════════════════
DROP TRIGGER IF EXISTS seed_stages_on_org_create ON organizations;

-- If the occasionsbox org already got the VioX defaults and no deal uses them,
-- swap in the OccasionsBox pipeline (mirrors crm.config.ts stages).
DO $$
DECLARE
  org_id uuid;
  stage_names text[];
BEGIN
  SELECT id INTO org_id FROM organizations WHERE slug = 'occasionsbox';
  IF org_id IS NULL THEN RETURN; END IF;

  SELECT array_agg(name ORDER BY sort_order) INTO stage_names
  FROM deal_stages WHERE organization_id = org_id;

  IF stage_names = ARRAY['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']
     AND NOT EXISTS (SELECT 1 FROM deals WHERE organization_id = org_id) THEN
    DELETE FROM deal_stages WHERE organization_id = org_id;
    INSERT INTO deal_stages (organization_id, name, color, sort_order, is_won, is_lost) VALUES
      (org_id, 'Inquiry',     '#B8860B', 0, false, false),
      (org_id, 'Quote Sent',  '#2C3E50', 1, false, false),
      (org_id, 'Approved',    '#DAA520', 2, false, false),
      (org_id, 'Fulfillment', '#CD853F', 3, false, false),
      (org_id, 'Delivered',   '#228B22', 4, true,  false),
      (org_id, 'Lost',        '#636e72', 5, false, true);
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- 8. ORDER INGEST idempotency lookup (deals.notes ILIKE '%paypal id%')
-- ═══════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_deals_org_created ON deals(organization_id, created_at DESC);

-- ═══════════════════════════════════════════
-- 9. SECURITY HARDENING (profiles, notifications)
-- ═══════════════════════════════════════════

-- 9a. Self-update may not change role or organization_id.
-- 001's profiles_update had no WITH CHECK, so any member could run
-- update({ role: 'owner' }) on their own row with the anon key + session.
-- get_user_role()/get_user_org_id() are STABLE SECURITY DEFINER and read the
-- pre-update row, so the new row must keep the current role/org.
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = get_user_role()
    AND organization_id = get_user_org_id()
  );

-- 9b. Belt and braces: a trigger that refuses role/org changes unless the
-- caller is the service role (auth.uid() IS NULL) or an owner/admin editing
-- somebody else's row. Independent of how the RLS policies combine.
CREATE OR REPLACE FUNCTION profiles_guard_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / SQL editor
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    IF OLD.id = auth.uid() OR get_user_role() NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Not allowed to change role or organization of this profile'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.role = 'owner' OR OLD.role = 'owner' THEN
      RAISE EXCEPTION 'The owner role can only be changed by the service role'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_guard_role_change ON profiles;
CREATE TRIGGER profiles_guard_role_change BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_guard_role_change();

-- 9c. Profiles are only ever created by the service role (/api/auth/setup and
-- /api/v1/team/invite). 001's profiles_insert let a removed team member
-- (whose auth user still exists) re-insert their own profile as 'owner'.
DROP POLICY IF EXISTS profiles_insert ON profiles;

-- 9d. One owner per organization. Closes the bootstrap race in
-- /api/auth/setup (two concurrent first signups both reading count = 0).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM profiles WHERE role = 'owner'
    GROUP BY organization_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'profiles_one_owner_per_org NOT created: an organization has more than one owner — fix the data, then re-run';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_owner_per_org
      ON profiles(organization_id) WHERE role = 'owner';
  END IF;
END $$;

-- 9e. 005's "Service role can insert notifications" had no TO clause and
-- WITH CHECK (true), so anon/authenticated could insert notifications into
-- any user's bell panel. The service role bypasses RLS and never needed it.
DROP POLICY IF EXISTS "Service role can insert notifications" ON notifications;
