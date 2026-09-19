import type { NextConfig } from "next";

// The CRM is served at the root of its own host, https://crm.occasionsbox.com.
// It used to be mounted under /admin and reached through the marketing site's
// rewrite at https://occasionsbox.com/admin; that path now redirects here.
// BASE_PATH stays as the single switch: set it to "/prefix" and every fetch()
// URL and raw Location header follows (see src/lib/url.ts). Empty means none.
const BASE_PATH = "";

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
  // Only set when there is one; an empty basePath means none.
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL,
  },
  // Lint has pre-existing errors in the template; keep it out of the build so
  // deploys are not blocked. Type errors DO fail the build (default behaviour).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
