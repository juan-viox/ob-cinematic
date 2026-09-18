-- OccasionsBox CRM — complete schema, in one file.
--
-- Paste this whole file into the Supabase SQL Editor of a NEW, EMPTY project
-- and run it once. It is the six files in supabase/migrations/ concatenated in
-- their required order, so you do not have to run them one at a time.
--
-- Do NOT run this against a project that already has the CRM schema: section 1
-- uses plain CREATE TABLE and will fail on the first existing table. To bring an
-- older CRM database up to date instead, run only 006_occasionsbox.sql, which is
-- written to be idempotent.
--
-- After running, follow "Supabase Auth URL configuration" in crm/README.md.


-- ═══════════════════════════════════════════════════════════════
-- migrations/001_initial_schema.sql
-- ═══════════════════════════════════════════════════════════════

-- VioX CRM — Initial Schema
-- Multi-tenant CRM for cinematic site clients

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- NOTE: get_user_org_id() is created AFTER profiles table (see below)

-- ═══════════════════════════════════════════
-- 1. ORGANIZATIONS (multi-tenant root)
-- ═══════════════════════════════════════════
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 2. PROFILES (users linked to orgs)
-- ═══════════════════════════════════════════
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_profiles_org ON profiles(organization_id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Get current user's organization ID (for RLS) — must be after profiles table
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════
-- 3. COMPANIES (accounts)
-- ═══════════════════════════════════════════
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  industry text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_companies_org ON companies(organization_id);
CREATE INDEX idx_companies_name ON companies(organization_id, name);
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 4. CONTACTS
-- ═══════════════════════════════════════════
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text,
  email text,
  phone text,
  job_title text,
  source text DEFAULT 'manual' CHECK (source IN ('manual', 'web_form', 'newsletter', 'voice_agent', 'booking', 'referral', 'import')),
  source_site_slug text,
  avatar_url text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, email)
);
CREATE INDEX idx_contacts_org ON contacts(organization_id);
CREATE INDEX idx_contacts_email ON contacts(organization_id, email);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 5. DEAL STAGES (configurable pipeline)
-- ═══════════════════════════════════════════
CREATE TABLE deal_stages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#6c5ce7',
  sort_order int NOT NULL DEFAULT 0,
  is_won boolean DEFAULT false,
  is_lost boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_deal_stages_org ON deal_stages(organization_id, sort_order);

-- Seed default stages when org is created
CREATE OR REPLACE FUNCTION seed_deal_stages()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO deal_stages (organization_id, name, color, sort_order, is_won, is_lost) VALUES
    (NEW.id, 'Lead', '#a29bfe', 0, false, false),
    (NEW.id, 'Qualified', '#6c5ce7', 1, false, false),
    (NEW.id, 'Proposal', '#fdcb6e', 2, false, false),
    (NEW.id, 'Negotiation', '#e17055', 3, false, false),
    (NEW.id, 'Won', '#00b894', 4, true, false),
    (NEW.id, 'Lost', '#636e72', 5, false, true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seed_stages_on_org_create
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_deal_stages();

-- ═══════════════════════════════════════════
-- 6. DEALS (pipeline)
-- ═══════════════════════════════════════════
CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  stage_id uuid NOT NULL REFERENCES deal_stages(id) ON DELETE RESTRICT,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  amount decimal(12,2) DEFAULT 0,
  probability int DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  close_date date,
  closed_at timestamptz,
  sort_order int DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_deals_org ON deals(organization_id);
CREATE INDEX idx_deals_stage ON deals(stage_id, sort_order);
CREATE INDEX idx_deals_contact ON deals(contact_id);
CREATE INDEX idx_deals_close_date ON deals(organization_id, close_date);
CREATE TRIGGER deals_updated_at BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 7. ACTIVITIES
-- ═══════════════════════════════════════════
CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'task', 'note', 'voice_agent', 'form_submission')),
  title text NOT NULL,
  description text,
  status text DEFAULT 'completed' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date timestamptz,
  completed_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_activities_org ON activities(organization_id);
CREATE INDEX idx_activities_contact ON activities(contact_id);
CREATE INDEX idx_activities_deal ON activities(deal_id);
CREATE INDEX idx_activities_due ON activities(organization_id, due_date) WHERE status = 'pending';
CREATE TRIGGER activities_updated_at BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 8. NOTES
-- ═══════════════════════════════════════════
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal', 'activity')),
  entity_id uuid NOT NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_notes_entity ON notes(entity_type, entity_id);
CREATE INDEX idx_notes_org ON notes(organization_id);
CREATE TRIGGER notes_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 9. TAGS
-- ═══════════════════════════════════════════
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text DEFAULT '#6c5ce7',
  UNIQUE(organization_id, name)
);
CREATE INDEX idx_tags_org ON tags(organization_id);

-- ═══════════════════════════════════════════
-- 10. ENTITY TAGS (polymorphic join)
-- ═══════════════════════════════════════════
CREATE TABLE entity_tags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal')),
  entity_id uuid NOT NULL,
  UNIQUE(tag_id, entity_type, entity_id)
);
CREATE INDEX idx_entity_tags_entity ON entity_tags(entity_type, entity_id);

-- ═══════════════════════════════════════════
-- 11. CINEMATIC SITES (integration)
-- ═══════════════════════════════════════════
CREATE TABLE cinematic_sites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  domain text,
  api_key text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_sites_org ON cinematic_sites(organization_id);
CREATE INDEX idx_sites_api_key ON cinematic_sites(api_key);
CREATE TRIGGER sites_updated_at BEFORE UPDATE ON cinematic_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- 12. DOCUMENTS
-- ═══════════════════════════════════════════
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal')),
  entity_id uuid NOT NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  file_path text NOT NULL,
  file_size int,
  mime_type text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX idx_documents_org ON documents(organization_id);

-- ═══════════════════════════════════════════
-- ROW LEVEL SECURITY POLICIES
-- ═══════════════════════════════════════════

-- Organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_select ON organizations FOR SELECT USING (id = get_user_org_id());
CREATE POLICY org_update ON organizations FOR UPDATE USING (id = get_user_org_id());

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid());

-- Companies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_select ON companies FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY companies_update ON companies FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY companies_delete ON companies FOR DELETE USING (organization_id = get_user_org_id());

-- Contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (organization_id = get_user_org_id());

-- Deal Stages
ALTER TABLE deal_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY stages_select ON deal_stages FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY stages_insert ON deal_stages FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY stages_update ON deal_stages FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY stages_delete ON deal_stages FOR DELETE USING (organization_id = get_user_org_id());

-- Deals
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_select ON deals FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY deals_update ON deals FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY deals_delete ON deals FOR DELETE USING (organization_id = get_user_org_id());

-- Activities
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY activities_select ON activities FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY activities_update ON activities FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY activities_delete ON activities FOR DELETE USING (organization_id = get_user_org_id());

-- Notes
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notes_select ON notes FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY notes_insert ON notes FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY notes_update ON notes FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY notes_delete ON notes FOR DELETE USING (organization_id = get_user_org_id());

-- Tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_select ON tags FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY tags_insert ON tags FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY tags_update ON tags FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY tags_delete ON tags FOR DELETE USING (organization_id = get_user_org_id());

-- Entity Tags (join through tags table for org check)
ALTER TABLE entity_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY entity_tags_select ON entity_tags FOR SELECT
  USING (EXISTS (SELECT 1 FROM tags WHERE tags.id = entity_tags.tag_id AND tags.organization_id = get_user_org_id()));
CREATE POLICY entity_tags_insert ON entity_tags FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tags WHERE tags.id = entity_tags.tag_id AND tags.organization_id = get_user_org_id()));
CREATE POLICY entity_tags_delete ON entity_tags FOR DELETE
  USING (EXISTS (SELECT 1 FROM tags WHERE tags.id = entity_tags.tag_id AND tags.organization_id = get_user_org_id()));

-- Cinematic Sites
ALTER TABLE cinematic_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY sites_select ON cinematic_sites FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY sites_insert ON cinematic_sites FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY sites_update ON cinematic_sites FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY sites_delete ON cinematic_sites FOR DELETE USING (organization_id = get_user_org_id());

-- Documents
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY docs_select ON documents FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY docs_insert ON documents FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY docs_delete ON documents FOR DELETE USING (organization_id = get_user_org_id());


-- ═══════════════════════════════════════════════════════════════
-- migrations/002_org_branding_superadmin_v2.sql
-- ═══════════════════════════════════════════════════════════════

-- VioX CRM — Migration 002: Org Branding + Super Admin
-- Run this AFTER migration 001 has already been applied

-- ═══════════════════════════════════════════
-- 1. ADD BRANDING COLUMNS TO ORGANIZATIONS
-- ═══════════════════════════════════════════
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN logo_url text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN primary_color text DEFAULT '#334155';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN secondary_color text DEFAULT '#F5F0EB';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN accent_color text DEFAULT '#8B7355';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN accent2_color text DEFAULT '#C9B8A8';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN accent3_color text DEFAULT '#6B7C6E';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN dark_color text DEFAULT '#1A1A2E';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN light_color text DEFAULT '#FAFAF8';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN display_font text DEFAULT 'Cormorant Garamond';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN body_font text DEFAULT 'Jost';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN tagline text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN website text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN phone text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN email text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN address text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN city text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN state text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN instagram text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN business_type text;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN is_active boolean DEFAULT true;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN plan text DEFAULT 'free';
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN max_users int DEFAULT 3;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD COLUMN max_contacts int DEFAULT 500;
  EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ═══════════════════════════════════════════
-- 2. SUPER ADMIN TABLE
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS super_admins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Super admin check function
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = auth.uid())
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Update RLS policies for super admin access
DROP POLICY IF EXISTS org_select ON organizations;
CREATE POLICY org_select ON organizations FOR SELECT
  USING (id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS org_update ON organizations;
CREATE POLICY org_update ON organizations FOR UPDATE
  USING (id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS org_insert ON organizations;
CREATE POLICY org_insert ON organizations FOR INSERT
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS activities_select ON activities;
CREATE POLICY activities_select ON activities FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS companies_select ON companies;
CREATE POLICY companies_select ON companies FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS sites_select ON cinematic_sites;
CREATE POLICY sites_select ON cinematic_sites FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

DROP POLICY IF EXISTS stages_select ON deal_stages;
CREATE POLICY stages_select ON deal_stages FOR SELECT
  USING (organization_id = get_user_org_id() OR is_super_admin());

-- RLS for super_admins table
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sa_select ON super_admins;
CREATE POLICY sa_select ON super_admins FOR SELECT
  USING (user_id = auth.uid() OR is_super_admin());

-- ═══════════════════════════════════════════
-- 3. PORTAL USERS TABLE
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS portal_users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_users_org ON portal_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(email);

DO $$ BEGIN
  CREATE TRIGGER portal_users_updated_at BEFORE UPDATE ON portal_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_select ON portal_users;
CREATE POLICY portal_select ON portal_users FOR SELECT
  USING (organization_id = get_user_org_id() OR user_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS portal_insert ON portal_users;
CREATE POLICY portal_insert ON portal_users FOR INSERT
  WITH CHECK (organization_id = get_user_org_id() OR is_super_admin());
DROP POLICY IF EXISTS portal_update ON portal_users;
CREATE POLICY portal_update ON portal_users FOR UPDATE
  USING (organization_id = get_user_org_id() OR user_id = auth.uid() OR is_super_admin());

-- ═══════════════════════════════════════════
-- 4. EXPAND PROFILE ROLES
-- ═══════════════════════════════════════════
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'member', 'viewer'));


-- ═══════════════════════════════════════════════════════════════
-- migrations/003_email_templates.sql
-- ═══════════════════════════════════════════════════════════════

-- ============================================
-- 003: Email Templates, Products, Invoices, Workflows
-- ============================================

-- ========== EMAIL TEMPLATES ==========
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  category text DEFAULT 'general',
  variables text[] DEFAULT '{}',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates(organization_id);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY et_select ON email_templates FOR SELECT USING (organization_id = get_user_org_id() OR is_super_admin());
CREATE POLICY et_insert ON email_templates FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY et_update ON email_templates FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY et_delete ON email_templates FOR DELETE USING (organization_id = get_user_org_id());
DO $$ BEGIN
  CREATE TRIGGER email_templates_updated_at BEFORE UPDATE ON email_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========== PRODUCTS ==========
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price decimal(12,2) NOT NULL DEFAULT 0,
  unit text DEFAULT 'each',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(organization_id);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY prod_all ON products FOR ALL USING (organization_id = get_user_org_id() OR is_super_admin());

-- ========== INVOICES ==========
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id),
  deal_id uuid REFERENCES deals(id),
  invoice_number text NOT NULL,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  issue_date date DEFAULT CURRENT_DATE,
  due_date date,
  subtotal decimal(12,2) DEFAULT 0,
  tax_rate decimal(5,2) DEFAULT 0,
  tax_amount decimal(12,2) DEFAULT 0,
  total decimal(12,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(organization_id);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_all ON invoices FOR ALL USING (organization_id = get_user_org_id() OR is_super_admin());
DO $$ BEGIN
  CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========== INVOICE ITEMS ==========
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  description text NOT NULL,
  quantity decimal(10,2) DEFAULT 1,
  unit_price decimal(12,2) NOT NULL,
  total decimal(12,2) NOT NULL,
  sort_order int DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ii_all ON invoice_items FOR ALL USING (
  EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_items.invoice_id AND invoices.organization_id = get_user_org_id())
  OR is_super_admin()
);

-- ========== WORKFLOWS ==========
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('contact_created', 'deal_created', 'deal_stage_changed', 'deal_won', 'deal_lost', 'activity_created', 'form_submitted', 'manual')),
  trigger_config jsonb DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]',
  is_active boolean DEFAULT true,
  run_count int DEFAULT 0,
  last_run_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflows_org ON workflows(organization_id);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_all ON workflows FOR ALL USING (organization_id = get_user_org_id() OR is_super_admin());
DO $$ BEGIN
  CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- migrations/004_custom_fields.sql
-- ═══════════════════════════════════════════════════════════════

-- VioX CRM — Custom Fields System
-- Allows users to define custom fields for contacts, companies, and deals

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal')),
  field_name text NOT NULL,
  field_label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'multiselect', 'checkbox', 'url', 'email', 'phone', 'textarea')),
  options jsonb DEFAULT '[]',
  is_required boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, entity_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_cfd_org_entity ON custom_field_definitions(organization_id, entity_type);

CREATE TABLE IF NOT EXISTS custom_field_values (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  field_id uuid NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  value text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cfv_field ON custom_field_values(field_id);

CREATE TRIGGER cfv_updated_at BEFORE UPDATE ON custom_field_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies for custom_field_definitions
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cfd_select ON custom_field_definitions FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY cfd_insert ON custom_field_definitions FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY cfd_update ON custom_field_definitions FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY cfd_delete ON custom_field_definitions FOR DELETE USING (organization_id = get_user_org_id());

-- RLS Policies for custom_field_values (join through definitions for org check)
ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY cfv_select ON custom_field_values FOR SELECT
  USING (EXISTS (SELECT 1 FROM custom_field_definitions WHERE custom_field_definitions.id = custom_field_values.field_id AND custom_field_definitions.organization_id = get_user_org_id()));
CREATE POLICY cfv_insert ON custom_field_values FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM custom_field_definitions WHERE custom_field_definitions.id = custom_field_values.field_id AND custom_field_definitions.organization_id = get_user_org_id()));
CREATE POLICY cfv_update ON custom_field_values FOR UPDATE
  USING (EXISTS (SELECT 1 FROM custom_field_definitions WHERE custom_field_definitions.id = custom_field_values.field_id AND custom_field_definitions.organization_id = get_user_org_id()));
CREATE POLICY cfv_delete ON custom_field_values FOR DELETE
  USING (EXISTS (SELECT 1 FROM custom_field_definitions WHERE custom_field_definitions.id = custom_field_values.field_id AND custom_field_definitions.organization_id = get_user_org_id()));


-- ═══════════════════════════════════════════════════════════════
-- migrations/005_notifications.sql
-- ═══════════════════════════════════════════════════════════════

-- Notifications table for in-app notification system
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('deal_won', 'deal_lost', 'new_lead', 'task_due', 'mention', 'assignment', 'system')),
  title text NOT NULL,
  message text,
  entity_type text,
  entity_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- RLS policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════
-- migrations/006_occasionsbox.sql
-- ═══════════════════════════════════════════════════════════════

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
