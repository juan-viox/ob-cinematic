-- OccasionsBox CRM — Migration 008: function hardening
-- Run AFTER 007_catalogue_occasions_proposals.sql. Idempotent; re-run freely.
--
-- Raised by Supabase's database linter against the live project:
--
--   1. function_search_path_mutable (10 functions). A SECURITY DEFINER function
--      with a caller-controlled search_path can be made to resolve an
--      unqualified name to an object the caller planted, and then runs it with
--      the definer's privileges. Pinning search_path closes that. The
--      SECURITY INVOKER ones are pinned too: same class of bug, and it costs
--      nothing. pg_temp goes last so a temp object can never shadow a real one.
--
--   2. next_document_number is EXECUTE-able by anon. It writes — every call
--      increments a counter — so an anonymous caller who learned an
--      organisation's uuid could burn proposal and order numbers and leave
--      gaps in the sequence. Only signed-in members and the service role
--      need it.
--
-- get_user_org_id, get_user_role and is_super_admin stay callable by anon on
-- purpose: RLS policy expressions are evaluated as the querying role, so
-- revoking EXECUTE would turn "no rows" into an error for anon-role queries.
-- All three only read auth.uid(), which is NULL for anon, so they return NULL.

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'update_updated_at', 'get_user_org_id', 'get_user_role', 'is_super_admin',
        'seed_deal_stages', 'set_organization_id_default', 'documents_sync_columns',
        'profiles_guard_role_change', 'apply_inventory_movement', 'next_document_number'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', f.sig);
  END LOOP;
END $$;

-- Writable, so signed-in members only.
DO $$ BEGIN
  IF to_regprocedure('public.next_document_number(uuid, text, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION next_document_number(uuid, text, text) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION next_document_number(uuid, text, text) FROM anon;
    GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, text) TO authenticated;
    GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, text) TO service_role;
  END IF;
END $$;
