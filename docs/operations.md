# Operations

Everything here is run by hand, with explicit scope. The one exception is the daily update on GitHub (`.github/workflows/update.yml`, see `docs/running-a-corpus.md#the-daily-update`). Every command that calls a model has positive limits and stops at the first one it would cross.

## Setup

```sh
npm ci                      # Node 22.18 or newer
cp .env.example .env        # then fill in, never commit
```

`.env` holds `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` (the operator keeps them in a password manager). On this route (a local run billed to API keys) reviews use the APIs only. The daily update on GitHub takes the other route: the two subscription clients, fenced so they have no shell or tools, with a probe that proves the fence before any real call (`scripts/probe-subscription.ts`, `docs/running-a-corpus.md`). Without a key the affected review is held as `verification_unavailable`; nothing publishes on one provider.

Private source text, full quotations, drafts, and raw provider responses live in `.cache/private-sources/` (or `PC_PRIVATE_DIR`). It is never in git. The daily update downloads it from private storage at the start of a run and saves it back after every stage; the copy on the runner is deleted with the runner. See `docs/adr/0002-private-source-retention.md` for what that means if it is lost.

## The research loop

This is the loop for a hand-picked selection. For every claim in a corpus, run on subscriptions, see `docs/running-a-corpus.md`.

1. Discover posts in a window: `node scripts/discover.ts <window-id>`. Writes `research/coverage/<window>.json` and captures each post through the safe fetcher.
2. Freeze a selection: `research/selection/<file>.md` lists candidates in policy order before any outcome is looked up.
3. Draft: write `.cache/private-sources/drafts/<claim-id>.yaml` (format: `Draft` in `scripts/lib/draft.ts`).
4. Ingest: `node scripts/ingest.ts <claim-id>...`. Captures any new source, checks every quotation by code, and writes sealed records only if the whole draft is valid. A changed claim needs `claim_revision_reason`.
5. Review: `node scripts/review.ts <claim-id>... --spend-ceiling <usd> [--max-calls N] [--max-input-tokens N] [--max-output-tokens N] [--max-minutes N] [--concurrency N]`. Add `--dry-run` to see the size of each case without calling anyone. Writes review records, a sealed assessment per claim, and a run report in `research/runs/`.
6. Release: `node scripts/release.ts [--dry-run]`. Builds the manifest, writes events, and moves the current-release pointer. Refuses if the code that builds it is uncommitted, if any record is invalid, or if the quoting cap is exceeded.
7. Build: `npm run build`. The site renders only the current release.
8. Promote: after the host has accepted the exact `dist/` that was built, `node scripts/promote.ts --environment preview|production` records an activation receipt (release, commit, artifact digest). Production refuses a dirty tree, open regressions, or a collection below the launch floor (20 records, 8 per person).

## Costs (measured)

On the first pilot record, two reviews plus the final-text check cost an estimated $0.17 to $0.24 per claim at list prices (Claude Opus 5.5 $4/$20 per million tokens; OpenAI gpt-6-astra $10/$50, from third-party listings and unverified on openai.com, so estimates err high). Budget about $0.50 per claim per full review, more when a case has many evidence items. `ops/prices.yaml` holds the rates; a model without a price cannot run under a ceiling.

## When something is wrong

- A published assessment has a verified problem: write an `Invalidation` record (schema in `src/schema.ts`) with receipts and run `node scripts/invalidate.ts <file>`. It flags or withdraws that assessment and changes nothing else. A quotation problem is re-checked against the private source text on the spot; counterevidence and attribution failures need completed reviews from both providers. A raw dispute cannot use this path.
- A bad release: `node scripts/rollback.ts --to <release-id>`. It refuses if the target would bring back something withdrawn or flagged since; then fix forward with a new release.
- A provider outage or a budget stop: the affected records hold with that reason. An earlier published assessment stays up with a dated notice. Rerun when the provider is back.
- A privacy, rights, or safety complaint about quoted text: handled privately by the editor (the contact address is to be decided). Removing text from current and historical pages is an editor action recorded in the data; copies already distributed cannot be recalled.

## Disputes

Readers open a GitHub issue from the template, which carries the claim and assessment ids. The editor triages each one by hand and records the disposition (upheld, rejected, under review) with a reason. An upheld dispute that shows a verified problem goes through the invalidation path; a corrected record gets a new assessment through the full gate. Automated dispute triage is out of scope for the first release.

## Not set up

The domain punditclaims.ai is registered at Namecheap (2026-10-28, two-year term to 2028-10-28, auto-renew on, WHOIS privacy on). It still uses Namecheap's default DNS with the parking page and a redirect to www; nothing points at a host yet. The intended host is Cloudflare Pages, as for Because of AI: move the nameservers to Cloudflare, create a Pages project from the GitHub repository, add punditclaims.ai and www as custom domains, and set `PC_SITE_ORIGIN=https://punditclaims.ai` in the Pages build. No scheduled run exists. Each of those is a separate, explicit decision.

Cloudflare Pages takes at most 20,000 files per deployment and 25 MiB per file. `npm run build` fails above 19,000 files or on any file over 25 MiB. `npm run build:scale` builds a synthetic release of 11,000 claims to show the site stays inside both (see `docs/adr/0004-site-at-scale.md`).
