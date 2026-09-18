export interface Profile {
  id: string
  organization_id: string
  email?: string
  full_name: string
  avatar_url?: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
  updated_at: string
}

export interface Company {
  id: string
  organization_id: string
  name: string
  domain?: string
  industry?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  notes?: string
  created_at: string
  updated_at: string
  contact_count?: number
}

export interface Contact {
  id: string
  organization_id: string
  company_id?: string
  first_name: string
  last_name?: string
  email?: string
  phone?: string
  job_title?: string
  source?: 'manual' | 'web_form' | 'newsletter' | 'voice_agent' | 'booking' | 'referral' | 'import' | 'cold_call' | 'other'
  source_site_slug?: string
  /** Added in 006_occasionsbox.sql; DB default 'lead'. */
  status: 'lead' | 'active' | 'inactive'
  avatar_url?: string
  notes?: string
  created_at: string
  updated_at: string
  company?: Company
}

export interface DealStage {
  id: string
  organization_id: string
  name: string
  color: string
  sort_order: number
  is_won?: boolean
  is_lost?: boolean
  created_at: string
}

export interface Deal {
  id: string
  organization_id: string
  contact_id?: string
  company_id?: string
  stage_id: string
  owner_id?: string
  title: string
  amount: number
  probability?: number
  close_date?: string
  closed_at?: string
  sort_order?: number
  notes?: string
  created_at: string
  updated_at: string
  contact?: Contact
  company?: Company
  stage?: DealStage
}

export interface Activity {
  id: string
  organization_id: string
  contact_id?: string
  deal_id?: string
  user_id?: string
  type: 'call' | 'email' | 'meeting' | 'task' | 'note' | 'voice_agent' | 'form_submission'
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  due_date?: string
  completed_at?: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
  contact?: Contact
  deal?: Deal
}

export interface Note {
  id: string
  organization_id: string
  entity_type: 'contact' | 'company' | 'deal' | 'activity'
  entity_id: string
  user_id?: string
  content: string
  created_at: string
  updated_at: string
}

export interface Tag {
  id: string
  organization_id: string
  name: string
  color?: string
}

export interface EntityTag {
  id: string
  tag_id: string
  entity_type: 'contact' | 'company' | 'deal'
  entity_id: string
}

export interface Document {
  id: string
  organization_id: string
  /** Polymorphic link (kept in sync from contact_id/company_id/deal_id by a DB trigger, see 006). */
  entity_type?: 'contact' | 'company' | 'deal' | null
  entity_id?: string | null
  contact_id?: string | null
  company_id?: string | null
  deal_id?: string | null
  user_id?: string
  name: string
  /** Storage object path (mirrors file_url when uploaded through FileAttachments). */
  file_path?: string | null
  file_url?: string | null
  file_size?: number
  mime_type?: string | null
  file_type?: string | null
  created_at: string
}

export interface EmailTemplate {
  id: string
  organization_id: string
  name: string
  subject: string
  body: string
  category: string
  variables: string[]
  created_by?: string
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  organization_id: string
  name: string
  description?: string
  price: number
  unit: string
  is_active: boolean
  created_at: string
}

export interface Invoice {
  id: string
  organization_id: string
  contact_id?: string
  deal_id?: string
  invoice_number: string
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
  issue_date: string
  due_date?: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  notes?: string
  created_at: string
  updated_at: string
  contact?: Contact
  deal?: Deal
  items?: InvoiceItem[]
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  product_id?: string
  description: string
  quantity: number
  unit_price: number
  total: number
  sort_order: number
}

export interface CinematicSite {
  id: string
  organization_id: string
  name: string
  slug: string
  domain?: string
  api_key: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WorkflowTrigger = 'contact_created' | 'deal_created' | 'deal_stage_changed' | 'deal_won' | 'deal_lost' | 'activity_created' | 'form_submitted' | 'manual'

export type WorkflowActionType = 'send_email' | 'create_activity' | 'update_field' | 'create_deal' | 'add_tag' | 'notify_user' | 'wait'

export interface WorkflowAction {
  id: string
  type: WorkflowActionType
  config: Record<string, unknown>
}

export interface Workflow {
  id: string
  organization_id: string
  name: string
  description?: string
  trigger_type: WorkflowTrigger
  trigger_config: Record<string, unknown>
  actions: WorkflowAction[]
  is_active: boolean
  run_count: number
  last_run_at?: string
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────
// Catalogue, inventory, occasions, proposals, orders (007)
// ─────────────────────────────────────────────

export type ProductCategory = 'box' | 'tier' | 'plan' | 'addon' | 'service' | 'other'

/** Product, with the columns 007 adds. Text columns are nullable in the DB. */
export interface CatalogueProduct extends Omit<Product, 'description'> {
  description?: string | null
  sku?: string | null
  slug?: string | null
  category: ProductCategory
  image_url?: string | null
  contents: string[]
  occasions: string[]
  caution?: string | null
  price_note?: string | null
  cost?: number | null
  track_stock: boolean
  stock_on_hand: number
  reorder_at: number
  sort_order: number
  updated_at?: string
}

export interface InventoryItem {
  id: string
  organization_id: string
  brand: string
  name: string
  description?: string | null
  category: 'component' | 'packaging' | 'stationery' | 'other'
  unit_cost?: number | null
  on_hand: number
  reorder_at: number
  supplier?: string | null
  supplier_url?: string | null
  is_active: boolean
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface ProductComponent {
  id: string
  organization_id: string
  product_id: string
  inventory_item_id: string
  quantity: number
  sort_order: number
  item?: InventoryItem
  product?: Pick<CatalogueProduct, 'id' | 'name' | 'sku'>
}

export type InventoryMovementReason =
  | 'received' | 'adjustment' | 'count' | 'packed' | 'sold' | 'shipped' | 'damaged' | 'returned' | 'sample'

export interface InventoryMovement {
  id: string
  organization_id: string
  inventory_item_id?: string | null
  product_id?: string | null
  delta: number
  reason: InventoryMovementReason
  reference_type?: string | null
  reference_id?: string | null
  note?: string | null
  user_id?: string | null
  created_at: string
}

export type OccasionCategory = 'holiday' | 'business' | 'personal' | 'seasonal' | 'real_estate' | 'internal'

export interface Occasion {
  id: string
  organization_id: string
  name: string
  slug: string
  category: OccasionCategory
  rule: 'fixed' | 'nth_weekday' | 'last_weekday' | 'last_full_week' | 'manual'
  month?: number | null
  day?: number | null
  weekday?: number | null
  nth?: number | null
  lead_time_days: number
  description?: string | null
  talking_points?: string | null
  suggested_skus: string[]
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type ClientOccasionStatus =
  | 'planned' | 'proposed' | 'approved' | 'in_production' | 'shipped' | 'delivered' | 'skipped'

export interface ClientOccasion {
  id: string
  organization_id: string
  contact_id?: string | null
  company_id?: string | null
  occasion_id?: string | null
  title: string
  occasion_date: string
  recurs_annually: boolean
  recipient_name?: string | null
  recipient_notes?: string | null
  ship_to?: string | null
  quantity: number
  budget?: number | null
  product_id?: string | null
  status: ClientOccasionStatus
  deal_id?: string | null
  proposal_id?: string | null
  order_id?: string | null
  notes?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  contact?: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'> | null
  company?: Pick<Company, 'id' | 'name'> | null
  occasion?: Pick<Occasion, 'id' | 'name' | 'lead_time_days' | 'category'> | null
  product?: Pick<CatalogueProduct, 'id' | 'name' | 'price' | 'sku'> | null
}

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired'

export interface Proposal {
  id: string
  organization_id: string
  proposal_number: string
  contact_id?: string | null
  company_id?: string | null
  deal_id?: string | null
  client_occasion_id?: string | null
  title: string
  status: ProposalStatus
  issue_date: string
  valid_until?: string | null
  needed_by?: string | null
  intro?: string | null
  notes?: string | null
  terms?: string | null
  subtotal: number
  discount_amount: number
  shipping_amount: number
  tax_rate: number
  tax_amount: number
  total: number
  public_token: string
  sent_at?: string | null
  viewed_at?: string | null
  accepted_at?: string | null
  declined_at?: string | null
  accepted_by_name?: string | null
  accepted_note?: string | null
  invoice_id?: string | null
  order_id?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
  contact?: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'> & { company?: Pick<Company, 'name'> | null } | null
  company?: Pick<Company, 'id' | 'name'> | null
  deal?: Pick<Deal, 'id' | 'title'> | null
  items?: ProposalItem[]
}

export interface ProposalItem {
  id: string
  proposal_id: string
  product_id?: string | null
  description: string
  details?: string | null
  quantity: number
  unit_price: number
  total: number
  sort_order: number
}

export type OrderPaymentStatus = 'unverified' | 'pending' | 'paid' | 'partially_paid' | 'refunded' | 'cancelled'
export type OrderFulfillmentStatus = 'new' | 'confirmed' | 'packing' | 'shipped' | 'delivered' | 'on_hold' | 'cancelled'

export interface Order {
  id: string
  organization_id: string
  order_number: string
  source: 'website' | 'proposal' | 'concierge' | 'manual' | 'voice_agent'
  contact_id?: string | null
  company_id?: string | null
  deal_id?: string | null
  proposal_id?: string | null
  client_occasion_id?: string | null
  payment_status: OrderPaymentStatus
  payment_provider?: string | null
  payment_reference?: string | null
  payer_name?: string | null
  payer_email?: string | null
  payer_phone?: string | null
  fulfillment_status: OrderFulfillmentStatus
  ship_to_name?: string | null
  ship_to_address?: Record<string, string> | null
  carrier?: string | null
  tracking_number?: string | null
  shipped_at?: string | null
  delivered_at?: string | null
  needed_by?: string | null
  gift_message?: string | null
  currency: string
  subtotal: number
  discount_amount: number
  shipping_amount: number
  tax_amount: number
  total: number
  verified: boolean
  verified_by?: string | null
  notes?: string | null
  metadata: Record<string, unknown>
  placed_at: string
  created_at: string
  updated_at: string
  contact?: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'phone'> | null
  items?: OrderItem[]
}

export interface OrderItem {
  id: string
  order_id: string
  product_id?: string | null
  sku?: string | null
  description: string
  variant?: string | null
  /** Which printed 5x7 card, or the blank one. */
  card?: string | null
  /** What the buyer asked to be handwritten inside it. */
  card_message?: string | null
  quantity: number
  unit_price: number
  total: number
  sort_order: number
}
