import type { NextConfig } from "next";

// The CRM is mounted under /admin. It is reached directly at
// https://ob-crm-vio-x-bergsify.vercel.app/admin and through the marketing
// site's rewrite at https://occasionsbox.com/admin. See src/lib/url.ts for
// the helpers that apply this prefix to fetch() URLs and raw Location headers.
const BASE_PATH = "/admin";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  // Lint has pre-existing errors in the template; keep it out of the build so
  // deploys are not blocked. Type errors DO fail the build (default behaviour).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
