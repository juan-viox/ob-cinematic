-- Alerts for things that arrive on their own: orders, inquiries, bookings,
-- calls Olivia took.
--
-- The notifications table already existed, along with the bell that reads it.
-- Nothing had ever written to it, so the CHECK on `type` only listed the seven
-- kinds somebody imagined in advance. An insert of 'new_order' was rejected
-- outright, which is the sort of failure that looks like "alerts don't work"
-- rather than "one constraint is too narrow".

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- the original seven
    'deal_won', 'deal_lost', 'new_lead', 'task_due', 'mention', 'assignment', 'system',
    -- things that arrive without anybody doing anything
    'new_order', 'new_booking', 'voice_call'
  ));

-- The unread badge counts across the whole org and the banner counts orders
-- still sitting at 'new', so both run on every page load. Neither is slow
-- today, and both get slower every week that orders accumulate.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_orders_awaiting
  ON orders(organization_id, created_at DESC)
  WHERE fulfillment_status = 'new';
