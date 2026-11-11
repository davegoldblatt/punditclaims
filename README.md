# Pundit Claims

A source-backed public register of AI claims by Gary Marcus and Ed Zitron: what was said, what the statement commits the speaker to, what dated evidence arrived, what assessment that evidence justifies, and what changed afterwards.

It is a curated register, not a rating of anyone. There is no accuracy score. The editorial rules are in `docs/policy.md`.

## Run your own register

The code is general. The people covered, their publications, the collection windows, and the site's name all live in `config/register.yaml`; nothing in the code names them. To track the claims of other public figures, copy the repository, edit that file, start with an empty data tree, and follow `docs/new-register.md`.

## Commands

```sh
npm ci             # install the pinned dependencies (Node 22.18 or newer)
npm test           # the rule fixtures, schema, loader, and policy tests
npm run validate   # every record in data/ against its schema, references, and hashes
npm run build      # the static site in dist/, the Pagefind index, then scripts/check-dist.ts
npm run build:fixture  # the same from the synthetic release (PC_RELEASE=fixture), never for deployment
npm run build:scale    # the same from a generated synthetic release of 11,000 claims (PC_FIXTURE_SCALE sets the size)
npm run preview    # serve dist/ locally
```

## Layout

- `config/register.yaml`: this deployment: the site, the people, their publications, and the collection windows.
- `src/policy.ts`, `policy/policy.yaml`, `docs/policy.md`: the editorial policy for code, for data readers, and for people. A test keeps them identical.
- `src/schema.ts`: every record family as a zod schema.
- `src/lib/data.ts`: loads and cross-checks the working data tree. `src/lib/rules.ts`: the judging rules code can enforce. `src/lib/records.ts`: constructors that seal a record's hash.
- `data/`: public records only. Full source text and full quotations stay in `.cache/` (gitignored).
- `fixtures/`: synthetic cases with `fx-` ids, never loaded as data. `fixtures/regressions.yaml` lists every known failure and the test that covers it.
- `research/`: coverage manifests, prompts, run logs, and the legacy dataset manifest (the legacy claims themselves are unverified and are not kept here).
- `docs/adr/`: decisions. `docs/reuse.md`: code adapted from Because of AI.

## Status

Live at [punditclaims.ai](https://punditclaims.ai) since 2026-10-29. A daily job (`.github/workflows/update.yml`) finds new posts, extracts and checks their claims, and publishes a release when a record a reader sees has changed.

## Corrections

Each claim page links to a dispute form in this repository's issues. Models from Anthropic and OpenAI do the checking and can be wrong, even when they agree. For a privacy, rights, or safety problem with a quote, write to the address on the site's About page and do not post publicly.

## License

Code MIT, data and text CC BY 4.0. See `LICENSE`.
