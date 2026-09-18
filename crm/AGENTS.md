<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This project runs Next.js 15 (App Router) under `basePath: '/admin'`. APIs,
conventions and file structure may differ from your training data. The
installed package (next@15.5.x) ships no `dist/docs/` directory, so verify
Next-specific behaviour against the compiled source instead of memory:

- `node_modules/next/dist/server/app-render/app-render.js` — `redirect()` and
  how `basePath` is prepended via `addPathPrefix` (raw `Location` headers are
  NOT prefixed; include `BASE_PATH` yourself — see `src/lib/url.ts`).
- `node_modules/next/dist/build/analysis/get-page-static-info.js` — middleware
  `matcher` entries are prefixed with `basePath` at build time.
- `node_modules/next/dist/server/web/adapter.js` and
  `node_modules/next/dist/server/lib/router-utils/` — middleware/rewrite
  behaviour with `basePath`.
- After `npx next build`, `.next/server/src/middleware.js` shows exactly what
  the middleware compiles to (it contains the `/admin` prefixed redirects).

Heed deprecation notices printed by `npx next build` and `npx tsc --noEmit`.
<!-- END:nextjs-agent-rules -->
