import type { NextConfig } from "next";

// The CRM is mounted under /admin. It is reached directly at
// https://ob-crm-vio-x-bergsify.vercel.app/admin and through the marketing
// site's rewrite at https://occasionsbox.com/admin. See src/lib/url.ts for
// the helpers that apply this prefix to fetch() URLs and raw Location headers.
const BASE_PATH = "/admin";

// The Supabase project the CRM talks to. The URL is a public endpoint, not a
// secret, so it is a default here and one less thing to paste; a value set in
// Vercel still wins.
//
// NEXT_PUBLIC_SUPABASE_ANON_KEY is NOT defaulted here. The anon key is public
// by design and safe to expose given row level security, which is enabled with
// org-scoped policies on every table, but this repository is public on GitHub
// and a committed JWT is indistinguishable from a leaked one to anybody
// reading it later. It is set in Vercel.
const SUPABASE_URL = "https://wztawjcxezojoqvpxvoa.supabase.co";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL,
  },
  // Lint has pre-existing errors in the template; keep it out of the build so
  // deploys are not blocked. Type errors DO fail the build (default behaviour).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
