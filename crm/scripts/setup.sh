#!/bin/bash
# OccasionsBox CRM — local setup wizard.
# Writes crm/.env.local. For production, paste the same variables into the
# Vercel project "ob-crm" (Root Directory: crm) instead.
set -e
cd "$(dirname "$0")/.."

echo ""
echo "  OccasionsBox CRM Setup"
echo "  ======================"
echo ""
echo "  This script writes .env.local for local development."
echo "  The CRM is served under the /admin base path."
echo ""

# Prompt for Supabase credentials
read -p "  Supabase URL: " SUPABASE_URL
read -p "  Supabase anon key: " SUPABASE_ANON_KEY
read -p "  Supabase service role key: " SUPABASE_SERVICE_KEY

# Validate inputs
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo ""
  echo "  Error: All Supabase credentials are required."
  exit 1
fi

# Generate API key for server-to-server ingest callers (e.g. the voice agent)
API_KEY=$(openssl rand -hex 32)

# Generate .env.local
cat > .env.local << EOT
# Supabase
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_KEY

# Ingest API key for server-to-server callers (x-api-key header).
# The marketing site does not need it: it is authorised by Origin.
SITE_API_KEY=$API_KEY

# Optional: comma-separated hostnames allowed to call the ingest API from a browser
# ALLOWED_ORIGINS=occasionsbox.com,www.occasionsbox.com

# Optional: absolute CRM URL (with /admin) used in team-invite emails
# NEXT_PUBLIC_APP_URL=https://ob-crm-vio-x-bergsify.vercel.app/admin

# Email (optional - add your Resend API key to enable email sending)
# RESEND_API_KEY=re_...
# RESEND_FROM_EMAIL=Hello@occasionsbox.com
EOT

echo ""
echo "  .env.local created successfully!"
echo ""
echo "  Next steps:"
echo "  1. Run the SQL migrations in your Supabase SQL Editor, in order:"
echo "     supabase/migrations/001_initial_schema.sql"
echo "     supabase/migrations/002_org_branding_superadmin_v2.sql"
echo "     supabase/migrations/003_email_templates.sql"
echo "     supabase/migrations/004_custom_fields.sql"
echo "     supabase/migrations/005_notifications.sql"
echo "     supabase/migrations/006_occasionsbox.sql"
echo ""
echo "  2. In Supabase Authentication -> URL Configuration add:"
echo "     Site URL:      https://ob-crm-vio-x-bergsify.vercel.app/admin"
echo "     Redirect URLs: https://ob-crm-vio-x-bergsify.vercel.app/admin/auth/callback"
echo "                    https://occasionsbox.com/admin/auth/callback"
echo "                    http://localhost:3000/admin/auth/callback"
echo ""
echo "  3. Start the dev server and open http://localhost:3000/admin"
echo "     npm run dev"
echo "     The first signup becomes the owner; invite others from Settings -> Team."
echo ""
echo "  4. Your ingest API key (for the voice agent / other servers):"
echo "     $API_KEY"
echo ""
echo "  Production: create Vercel project 'ob-crm' with Root Directory 'crm'"
echo "  and paste the variables from .env.example there."
echo ""
