-- Whether the buyer ticked "Text me order updates" at checkout.
--
-- The phone number on an order comes from PayPal or Stripe, which collect it
-- for their own reasons. Having a number is not permission to text it: US
-- carriers require a recorded opt-in for A2P 10DLC traffic, and so does the
-- TCPA. Every order text checks this column, so an order placed without the
-- box ticked is never texted, however the text is triggered.
--
-- Defaults to false, so every order placed before the checkbox existed stays
-- untexted.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;
