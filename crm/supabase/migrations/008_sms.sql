-- ═══════════════════════════════════════════
-- 008. Texting customers about their orders
--
-- Two things the code cannot do without:
--   1. somewhere to record that a customer asked us to stop texting, which
--      carriers and the law both require us to honour;
--   2. 'sms' as an activity type, so every message we send is on the
--      contact's timeline next to the calls and the emails.
-- ═══════════════════════════════════════════

-- 1. Opt-out. Default false: a customer who gave us their number at checkout
--    has not opted out, they simply have not opted out yet. Set true the
--    moment they reply STOP, and never send again until they reply START.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sms_opt_out_at timestamptz;

-- A number can reach us before it is attached to any contact (someone texts
-- STOP from a number we have never written to). Keep those refusals too, and
-- check both before sending.
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_org_phone ON sms_opt_outs(organization_id, phone);

ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_opt_outs_member_read ON sms_opt_outs;
CREATE POLICY sms_opt_outs_member_read ON sms_opt_outs
  FOR SELECT USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS sms_opt_outs_member_write ON sms_opt_outs;
CREATE POLICY sms_opt_outs_member_write ON sms_opt_outs
  FOR ALL USING (organization_id = get_user_org_id())
  WITH CHECK (organization_id = get_user_org_id());

-- 2. 'sms' joins the activity types, so a text shows on the timeline.
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check
  CHECK (type IN ('call', 'email', 'meeting', 'task', 'note', 'voice_agent', 'form_submission', 'sms'));
