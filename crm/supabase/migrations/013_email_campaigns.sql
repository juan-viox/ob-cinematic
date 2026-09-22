-- Bulk outreach: the opt-out that has to exist before the first send.
--
-- CAN-SPAM requires every commercial email to carry a working unsubscribe.
-- Texting already had sms_opt_out; email had nothing, because until now the
-- CRM only ever sent one message to one person who had asked for it.
--
-- The token is per-contact and random rather than the contact's id, so an
-- unsubscribe link cannot be walked: knowing one recipient's link tells you
-- nothing about anyone else's, and the public route can take the token alone
-- without ever exposing an internal id in an email that gets forwarded.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unsubscribe_token text
  NOT NULL DEFAULT encode(extensions.gen_random_bytes(18), 'hex');

-- A volatile default is evaluated per row, so contacts that already existed
-- each get their own token rather than sharing one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unsubscribe_token
  ON contacts(unsubscribe_token);

-- Finding everyone carrying a tag is the query a campaign runs; the existing
-- index only helps the other direction (all tags on one entity).
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag_id, entity_type);

COMMENT ON COLUMN contacts.email_opt_out IS
  'Set when this contact used an unsubscribe link. Campaigns must never send to a true.';
COMMENT ON COLUMN contacts.unsubscribe_token IS
  'Random per-contact secret for the public unsubscribe link. Never an internal id.';
