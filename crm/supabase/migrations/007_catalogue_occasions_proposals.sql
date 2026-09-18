-- OccasionsBox CRM — Migration 007: the business runs from the CRM
-- Run AFTER 006_occasionsbox.sql. Every statement is idempotent; re-run freely.
--
-- What this adds:
--   1. products becomes the catalogue: sku, category (box / tier / plan / addon /
--      service), image, contents, occasions, cautions, cost and stock.
--   2. inventory_items + product_components: what is inside each box, so the
--      components can be counted, reordered and costed. inventory_movements is
--      the audit trail; a trigger keeps the on-hand counts in step.
--   3. occasions: the gifting calendar (fixed dates and "nth weekday" rules),
--      and client_occasions: the dates we gift on behalf of each client.
--   4. proposals + proposal_items, with a public token so a client can read and
--      accept a proposal without logging in.
--   5. orders + order_items: every website purchase (and later, every accepted
--      proposal) as an order with fulfilment status and a link to the catalogue.
--   6. deals gains quantity / needed_by / occasion for opportunities the voice
--      agent and the outreach page create.
--   7. RLS, organization_id auto-fill and updated_at triggers for all of it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══════════════════════════════════════════
-- 1. PRODUCTS → CATALOGUE
-- ═══════════════════════════════════════════
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'box';
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS contents jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS occasions text[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS caution text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_note text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost decimal(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_on_hand int NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_at int NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check
  CHECK (category IN ('box', 'tier', 'plan', 'addon', 'service', 'other'));

-- One sku per organisation. Partial so legacy rows without a sku still fit.
CREATE UNIQUE INDEX IF NOT EXISTS products_org_sku ON products(organization_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_org_category ON products(organization_id, category, sort_order);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'products_updated_at' AND tgrelid = 'public.products'::regclass) THEN
    CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- 2. INVENTORY: components, bill of materials, movements
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand text NOT NULL DEFAULT '',
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'component'
    CHECK (category IN ('component', 'packaging', 'stationery', 'other')),
  unit_cost decimal(12,2),
  on_hand int NOT NULL DEFAULT 0,
  reorder_at int NOT NULL DEFAULT 0,
  supplier text,
  supplier_url text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_org_key
  ON inventory_items(organization_id, lower(brand), lower(name));
CREATE INDEX IF NOT EXISTS idx_inventory_items_org ON inventory_items(organization_id, is_active);

CREATE TABLE IF NOT EXISTS product_components (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (product_id, inventory_item_id)
);
CREATE INDEX IF NOT EXISTS idx_product_components_item ON product_components(inventory_item_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  delta int NOT NULL,
  reason text NOT NULL DEFAULT 'adjustment'
    CHECK (reason IN ('received', 'adjustment', 'count', 'packed', 'sold', 'shipped', 'damaged', 'returned', 'sample')),
  reference_type text,
  reference_id uuid,
  note text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  CHECK (inventory_item_id IS NOT NULL OR product_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at DESC);

-- A movement is the only way stock changes, so the counts always add up to
-- the audit trail. Deletes reverse the movement they undo.
CREATE OR REPLACE FUNCTION apply_inventory_movement()
RETURNS TRIGGER AS $$
DECLARE
  d int;
  item uuid;
  prod uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    d := -OLD.delta; item := OLD.inventory_item_id; prod := OLD.product_id;
  ELSE
    d := NEW.delta; item := NEW.inventory_item_id; prod := NEW.product_id;
  END IF;
  IF item IS NOT NULL THEN
    UPDATE inventory_items SET on_hand = on_hand + d WHERE id = item;
  END IF;
  IF prod IS NOT NULL THEN
    UPDATE products SET stock_on_hand = stock_on_hand + d WHERE id = prod;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_movements_apply ON inventory_movements;
CREATE TRIGGER inventory_movements_apply AFTER INSERT OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION apply_inventory_movement();

-- ═══════════════════════════════════════════
-- 3. OCCASIONS: the gifting calendar, and each client's dates
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS occasions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  category text NOT NULL DEFAULT 'holiday'
    CHECK (category IN ('holiday', 'business', 'personal', 'seasonal', 'real_estate', 'internal')),
  -- fixed: month/day. nth_weekday: the nth <weekday> of <month>. last_weekday:
  -- the last <weekday> of <month>. last_full_week: the <weekday> of the last
  -- Sunday-to-Saturday week that lies wholly inside <month>. manual: month/day
  -- for the current year, updated by hand (lunar and movable feasts).
  rule text NOT NULL DEFAULT 'fixed'
    CHECK (rule IN ('fixed', 'nth_weekday', 'last_weekday', 'last_full_week', 'manual')),
  month int CHECK (month BETWEEN 1 AND 12),
  day int CHECK (day BETWEEN 1 AND 31),
  weekday int CHECK (weekday BETWEEN 0 AND 6),
  nth int CHECK (nth BETWEEN 1 AND 5),
  -- Days before the occasion by which the proposal must be approved so the
  -- box ships in time (production lead time plus transit).
  lead_time_days int NOT NULL DEFAULT 28,
  description text,
  talking_points text,
  suggested_skus text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS client_occasions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  occasion_id uuid REFERENCES occasions(id) ON DELETE SET NULL,
  title text NOT NULL,
  occasion_date date NOT NULL,
  recurs_annually boolean NOT NULL DEFAULT false,
  recipient_name text,
  recipient_notes text,
  ship_to text,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  budget decimal(12,2),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'proposed', 'approved', 'in_production', 'shipped', 'delivered', 'skipped')),
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  proposal_id uuid,
  order_id uuid,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_occasions_date ON client_occasions(organization_id, occasion_date);
CREATE INDEX IF NOT EXISTS idx_client_occasions_contact ON client_occasions(contact_id);
CREATE INDEX IF NOT EXISTS idx_client_occasions_company ON client_occasions(company_id);

-- ═══════════════════════════════════════════
-- 4. PROPOSALS
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_number text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  client_occasion_id uuid REFERENCES client_occasions(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')),
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  needed_by date,
  intro text,
  notes text,
  terms text,
  subtotal decimal(12,2) NOT NULL DEFAULT 0,
  discount_amount decimal(12,2) NOT NULL DEFAULT 0,
  shipping_amount decimal(12,2) NOT NULL DEFAULT 0,
  tax_rate decimal(5,2) NOT NULL DEFAULT 0,
  tax_amount decimal(12,2) NOT NULL DEFAULT 0,
  total decimal(12,2) NOT NULL DEFAULT 0,
  -- The share link. 48 hex chars of entropy; a client reads and accepts the
  -- proposal at /p/<token> with nothing else.
  public_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  accepted_by_name text,
  accepted_note text,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  order_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, proposal_number)
);
CREATE INDEX IF NOT EXISTS idx_proposals_org_status ON proposals(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_contact ON proposals(contact_id);

CREATE TABLE IF NOT EXISTS proposal_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL,
  details text,
  quantity decimal(10,2) NOT NULL DEFAULT 1,
  unit_price decimal(12,2) NOT NULL DEFAULT 0,
  total decimal(12,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_proposal_items_proposal ON proposal_items(proposal_id, sort_order);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_occasions_proposal_id_fkey') THEN
    ALTER TABLE client_occasions ADD CONSTRAINT client_occasions_proposal_id_fkey
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════
-- 5. ORDERS: what was bought, from wherever it was bought
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  source text NOT NULL DEFAULT 'website'
    CHECK (source IN ('website', 'proposal', 'concierge', 'manual', 'voice_agent')),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL,
  client_occasion_id uuid REFERENCES client_occasions(id) ON DELETE SET NULL,
  -- Payment
  payment_status text NOT NULL DEFAULT 'unverified'
    CHECK (payment_status IN ('unverified', 'pending', 'paid', 'partially_paid', 'refunded', 'cancelled')),
  payment_provider text,
  payment_reference text,
  payer_name text,
  payer_email text,
  payer_phone text,
  -- Fulfilment
  fulfillment_status text NOT NULL DEFAULT 'new'
    CHECK (fulfillment_status IN ('new', 'confirmed', 'packing', 'shipped', 'delivered', 'on_hold', 'cancelled')),
  ship_to_name text,
  ship_to_address jsonb,
  carrier text,
  tracking_number text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  needed_by date,
  gift_message text,
  currency text NOT NULL DEFAULT 'USD',
  subtotal decimal(12,2) NOT NULL DEFAULT 0,
  discount_amount decimal(12,2) NOT NULL DEFAULT 0,
  shipping_amount decimal(12,2) NOT NULL DEFAULT 0,
  tax_amount decimal(12,2) NOT NULL DEFAULT 0,
  total decimal(12,2) NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  verified_by text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  placed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, order_number)
);
-- One order per PayPal capture; the ingest route is idempotent on it.
CREATE UNIQUE INDEX IF NOT EXISTS orders_org_payment_reference
  ON orders(organization_id, payment_provider, payment_reference)
  WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_org_placed ON orders(organization_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact_id);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(organization_id, fulfillment_status);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  sku text,
  description text NOT NULL,
  variant text,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price decimal(12,2) NOT NULL DEFAULT 0,
  total decimal(12,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_occasions_order_id_fkey') THEN
    ALTER TABLE client_occasions ADD CONSTRAINT client_occasions_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_order_id_fkey') THEN
    ALTER TABLE proposals ADD CONSTRAINT proposals_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Sequential order / proposal numbers per organisation, safe under
-- concurrent inserts (the invoice page counts rows, which is not).
CREATE TABLE IF NOT EXISTS document_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  next_value int NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, kind)
);

CREATE OR REPLACE FUNCTION next_document_number(p_org uuid, p_kind text, p_prefix text)
RETURNS text AS $$
DECLARE n int;
BEGIN
  INSERT INTO document_counters AS c (organization_id, kind, next_value)
    VALUES (p_org, p_kind, 2)
    ON CONFLICT (organization_id, kind) DO UPDATE
      SET next_value = c.next_value + 1
    RETURNING c.next_value - 1 INTO n;
  RETURN p_prefix || '-' || lpad(n::text, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════
-- 6. DEALS: structured opportunity fields
-- ═══════════════════════════════════════════
ALTER TABLE deals ADD COLUMN IF NOT EXISTS quantity int;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS needed_by date;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS occasion text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source text;

-- Post-call webhook idempotency: one activity per ElevenLabs conversation.
CREATE INDEX IF NOT EXISTS idx_activities_conversation
  ON activities(organization_id, (metadata->>'conversation_id'))
  WHERE metadata ? 'conversation_id';

-- ═══════════════════════════════════════════
-- 7. RLS, organization_id auto-fill, updated_at
-- ═══════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_items', 'product_components', 'inventory_movements',
    'occasions', 'client_occasions', 'proposals', 'orders'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (organization_id = get_user_org_id())', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (organization_id = get_user_org_id())', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (organization_id = get_user_org_id())', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (organization_id = get_user_org_id())', t || '_delete', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = t || '_set_org' AND tgrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION set_organization_id_default()',
        t || '_set_org', t
      );
    END IF;
  END LOOP;

  -- Child rows are scoped through their parent.
  ALTER TABLE proposal_items ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS proposal_items_all ON proposal_items;
  CREATE POLICY proposal_items_all ON proposal_items FOR ALL
    USING (EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_id AND p.organization_id = get_user_org_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_id AND p.organization_id = get_user_org_id()));

  ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS order_items_all ON order_items;
  CREATE POLICY order_items_all ON order_items FOR ALL
    USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.organization_id = get_user_org_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.organization_id = get_user_org_id()));

  ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS document_counters_select ON document_counters;
  CREATE POLICY document_counters_select ON document_counters FOR SELECT USING (organization_id = get_user_org_id());

  FOREACH t IN ARRAY ARRAY['inventory_items', 'occasions', 'client_occasions', 'proposals', 'orders'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = t || '_updated_at' AND tgrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
        t || '_updated_at', t
      );
    END IF;
  END LOOP;
END $$;

-- The number generator runs as the definer; members call it through RPC.
GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, text) TO authenticated;
