# Reuse from Because of AI

Source: https://github.com/davegoldblatt/becauseofai at the commit current on 2026-10-28. MIT License, Copyright (c) 2026 Dave Goldblatt. Each item below is adapted, not copied wholesale, and keeps that notice through `LICENSE`.

| Here | From | What changed |
|---|---|---|
| `src/lib/canonical.ts` | the content-hash idea in `scripts/lib/pipeline.ts` and `tests/binding.test.ts` | canonical JSON with integer-only numbers and per-record digest exclusion |
| `src/lib/dates.ts` | the partial-date floor/ceiling logic in `src/lib/format.ts` (`lagFor`) | general earliest/latest day helpers |
| `scripts/lib/vendors.ts` (planned, DAV-412) | `scripts/lib/vendors.ts` | two independent reviewers instead of drafter/verifier; usage and cost recorded, null when unknown |
| `scripts/lib/quote.ts` (planned, DAV-406) | `normalizeForMatch` and `findQuote` in `scripts/lib/source-text.ts` | returns offsets and a normalised-to-original map; never drops negation, numbers, or signs |
| `src/components/Assessment.astro`, `Occurrences.astro` (evidence and occurrence receipts) | `src/components/Receipt.astro` | the `<details>` receipt pattern, so receipts open without JavaScript; here each receipt is a full-width disclosure in a list, not a popover beside a number |
| `src/layouts/Base.astro` | `src/layouts/Base.astro` | the clean-route pathname (strip `.html`), canonical from the configured origin, skip link, header search form; no theme toggle, no inline scripts, no analytics comment, a release-identity meta tag, and the synthetic-preview band |
| `src/og/render.ts`, `src/pages/og/` | `src/og/render.ts` and `src/pages/og/[id].png.ts` | satori + resvg with static TTF instances read from the project root and no undefined style values; a different card (proposition, person, assessment label, dates only) |
| `src/pages/404.astro` | `src/pages/404.astro` | a real `dist/404.html` so unknown claim and version paths return 404 on Cloudflare Pages |
| `src/pages/sitemap.xml.ts` | `src/pages/sitemap.xml.ts` | hand-written sitemap with `lastmod` only from full dates |
| `public/_headers` | `public/_headers` | the same header set without the analytics host and without `'unsafe-inline'` for scripts or styles |
| `src/scripts/search.ts` | the Pagefind usage in `src/pages/search.astro` | the Pagefind JS API instead of Pagefind UI (Pagefind UI's `resetStyles` wipes site classes); excerpts are escaped and only `<mark>` is kept |

Not reused, on purpose:

- Because of AI's pre-gate publication exception (entries from before its gate stay published). Pundit Claims has no grandfathered records.
- The source reader's network policy and medical full-text heuristics. The fetcher here checks every redirect hop and resolved address and bounds every body.
- Any fallback that pushes directly to the production branch when a pull request cannot be opened.
- Content, social accounts, posting workflows, medical grades, domain settings, secrets.
