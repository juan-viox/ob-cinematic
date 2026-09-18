-- OccasionsBox CRM: Migration 010, the handwritten card on an order line
-- Run AFTER 009_rls_initplan_and_indexes.sql. Idempotent; re-run freely.
--
-- Every box ships with a 5x7 card, handwritten. The shop has always promised
-- "a complimentary handwritten card of your choice" in the contents list
-- without ever offering the choice, so the choice was being settled by email
-- after the sale, or not at all.
--
-- The shop now asks for it, and refuses checkout without it, so an order
-- arrives knowing which card goes in which box. Two columns rather than one,
-- because they answer different questions for whoever packs the box:
--
--   card          which printed card to take off the shelf, or the blank one
--                 that carries only the Occasions Box mark on the back
--   card_message  what the buyer wants written inside it, in their words
--
-- Both are per line, not per order: three boxes to three people is three
-- cards. Both stay nullable, because every order placed before this migration
-- has neither, and because a blank card with no message is a real choice.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS card text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS card_message text;

COMMENT ON COLUMN order_items.card IS
  'Which printed 5x7 card the buyer chose, or the blank one. Null on orders placed before the shop asked.';
COMMENT ON COLUMN order_items.card_message IS
  'What the buyer asked to be handwritten inside the card. Null or empty means the card speaks for itself.';

-- Processing and handling, charged on every order whatever the buyer pays
-- with. It is its own column rather than folded into the total because the
-- books need to tell the sale apart from the cost of taking the money: the
-- line items are revenue, this is a pass-through that lands straight back
-- with the processor.
--
-- orders already carries subtotal, discount_amount, shipping_amount and
-- tax_amount beside total, so this sits with them and defaults to zero for
-- every order placed before the shop charged it.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS handling_amount numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN orders.handling_amount IS
  'Processing and handling charged on the order. Uniform across payment methods, so it is a handling fee and not a card surcharge. Zero on orders placed before the shop charged it.';
