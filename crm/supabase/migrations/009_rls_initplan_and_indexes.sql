-- OccasionsBox CRM — Migration 009: RLS evaluation cost and two missing indexes
-- Run AFTER 008_function_hardening.sql. Idempotent; re-run freely.
--
-- From Supabase's performance linter against the live project:
--
--   1. auth_rls_initplan (8 policies). A bare auth.uid() inside a policy is
--      re-evaluated once per candidate row; wrapped as (SELECT auth.uid()) the
--      planner hoists it into an InitPlan and evaluates it once per query.
--      Semantics are identical — this is Supabase's documented idiom — so every
--      policy below is reproduced verbatim apart from that wrapping.
--
--   2. unindexed_foreign_keys. Most of the 30 it lists are nullable link
--      columns on tables that will hold thousands of rows, not millions, and an
--      index on each would cost more on write than it ever saves on read. Two
--      are worth having: organization_id on inventory_movements and
--      product_components. Both are the RLS predicate column on a table that
--      grows without bound (a movement per stock change, a row per component
--      per box), and neither had a covering index — every other org-scoped
--      table already leads an index with organization_id.
--
-- Deliberately not addressed: multiple_permissive_policies on profiles UPDATE.
-- profiles_update and profiles_admin_update are permissive and OR together by
-- design, which is why 006 repeats the caller/target conditions in both. The
-- duplication is the safety property, not an oversight.

-- ═══════════════════════════════════════════
-- 1. NOTIFICATIONS
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

-- ═══════════════════════════════════════════
-- 2. PORTAL USERS
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS portal_select ON portal_users;
CREATE POLICY portal_select ON portal_users FOR SELECT
  USING (
    organization_id = get_user_org_id()
    OR user_id = (SELECT auth.uid())
    OR is_super_admin()
  );

DROP POLICY IF EXISTS portal_update ON portal_users;
CREATE POLICY portal_update ON portal_users FOR UPDATE
  USING (
    organization_id = get_user_org_id()
    OR user_id = (SELECT auth.uid())
    OR is_super_admin()
  );

-- ═══════════════════════════════════════════
-- 3. SUPER ADMINS
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS sa_select ON super_admins;
CREATE POLICY sa_select ON super_admins FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR is_super_admin());

-- ═══════════════════════════════════════════
-- 4. PROFILES
-- ═══════════════════════════════════════════
-- Self-update: may not change role or organization_id (see 006 §9a).
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND role = get_user_role()
    AND organization_id = get_user_org_id()
  );

-- Owners/admins may re-role another member, never the owner and never self.
DROP POLICY IF EXISTS profiles_admin_update ON profiles;
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE
  USING (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('owner', 'admin')
    AND role <> 'owner'
    AND id <> (SELECT auth.uid())
  )
  WITH CHECK (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('owner', 'admin')
    AND role IN ('admin', 'member')
    AND id <> (SELECT auth.uid())
  );

DROP POLICY IF EXISTS profiles_admin_delete ON profiles;
CREATE POLICY profiles_admin_delete ON profiles FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND get_user_role() IN ('owner', 'admin')
    AND role <> 'owner'
    AND id <> (SELECT auth.uid())
  );

-- ═══════════════════════════════════════════
-- 5. THE TWO INDEXES WORTH ADDING
-- ═══════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_inventory_movements_org ON inventory_movements(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_components_org ON product_components(organization_id);
