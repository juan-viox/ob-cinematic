const crmConfig = {
  // Business Info
  name: 'OccasionsBox',
  slug: 'occasionsbox',
  tagline: 'Elevated Corporate & Closing Gifting',
  website: 'https://occasionsbox.com',
  phone: '(551) 245-7492',
  email: 'Hello@occasionsbox.com',
  address: 'Bergen County, NJ',
  instagram: '@occasionsbox',

  // Branding
  branding: {
    primaryColor: '#2C3E50',
    accentColor: '#B8860B',
    secondaryColor: '#FDF6F0',
    darkColor: '#1A1A2E',
    lightColor: '#FAFAF8',
    displayFont: 'Cormorant Garamond',
    bodyFont: 'Outfit',
    logoUrl: null as string | null,
  },

  // CRM Settings
  settings: {
    defaultDealStages: [
      { name: 'Inquiry', color: '#B8860B', sort_order: 0 },
      { name: 'Quote Sent', color: '#2C3E50', sort_order: 1 },
      { name: 'Approved', color: '#DAA520', sort_order: 2 },
      { name: 'Fulfillment', color: '#CD853F', sort_order: 3 },
      { name: 'Delivered', color: '#228B22', sort_order: 4, is_won: true },
      { name: 'Lost', color: '#636e72', sort_order: 5, is_lost: true },
    ] as Array<{ name: string; color: string; sort_order: number; is_won?: boolean; is_lost?: boolean }>,
    currency: 'USD',
    timezone: 'America/New_York',
  },

  // Marketing Site Integration (occasionsbox.com posts to /admin/api/v1/ingest/*)
  siteIntegration: {
    enabled: true,
    siteUrl: 'https://occasionsbox.com',
    apiKey: '', // Server-to-server callers use the SITE_API_KEY env var instead
  },

  // Feature Flags
  features: {
    leads: true,
    calendar: true,
    emails: true,
    invoices: true,
    automations: true,
    portal: true,
    aiProviders: true,
  },
}

export default crmConfig
export type CrmConfig = typeof crmConfig
