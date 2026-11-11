# 0001 Foundation choices

Date: 2026-10-28. Tickets: DAV-402, DAV-403, DAV-404.

1. Independent repository `punditclaims`, Astro 7 static output, TypeScript run natively by Node 22.18+ (type stripping), zod 4, `yaml` 2 with the core schema (dates stay strings), Pagefind. Versions are pinned exactly in `package.json` and the lockfile. These match Because of AI, which runs on them in production.
2. Plain CSS, no UI library, no Tailwind, no client framework.
3. Records are files: YAML for records people read (subjects, documents, occurrences, claim revisions, contracts), JSON for records machines write (versions, fetch events, packets, reviews, assessments, events, releases). Each record family has one directory; each file is named by its id.
4. Hashes are sha256 over canonical JSON (sorted keys, array order kept, integers only; precise decimals are strings). A record's own digest is excluded from its hashed body. `src/lib/records.ts` seals records so no writer hand-computes a hash.
5. The editorial vocabulary lives in `src/policy.ts`. `policy/policy.yaml` is the machine-readable copy and `docs/policy.md` the prose; `tests/policy.test.ts` keeps them identical.
6. Fixture ids start with `fx-`. The data loader rejects them outside tests, so synthetic content cannot reach a release.
7. The proposed domain punditclaims.ai is unverified. The site origin is `PC_SITE_ORIGIN`, defaulting to a Cloudflare Pages placeholder.
8. Disputes will use GitHub issues once a repository host exists; no other contact address is invented.
