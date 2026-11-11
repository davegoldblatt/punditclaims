// @ts-check
import { defineConfig } from "astro/config";

// Static output. The domain punditclaims.ai is registered (2026-10-28); the
// host is not connected yet. Pages are indexable only when PC_SITE_ORIGIN is
// set explicitly for a real deployment; every absolute URL derives from it. The same
// default lives in src/site.ts, which pages and scripts/check-dist.ts read.
export default defineConfig({
  site: process.env.PC_SITE_ORIGIN || "https://punditclaims.ai",
  output: "static",
  trailingSlash: "never",
  // Stylesheets and scripts stay external files, so the content-security
  // policy in public/_headers needs no 'unsafe-inline'.
  build: { format: "file", inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
});
