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
