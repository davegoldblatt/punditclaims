# Run your own register

This code is not specific to Gary Marcus and Ed Zitron. It records what any set of public figures said, what the statement commits them to, what dated evidence arrived, and what assessment the evidence supports, with two independent AI reviews and a code-decided publication gate. Everything that names the people lives in one configuration file and the data tree.

The step-by-step setup is in the README, under "Set it up for other pundits". This page covers what to think about before and after.

## What a copy changes

- `config/register.yaml`: the site and the people. Start from `config/register.example.yaml`.
- `data/subjects/<id>.yaml`: one sourced identification per person. Start from `config/subject.example.yaml`. `npm run validate` checks that the subjects and windows match the configuration.
- `public/people/<id>.jpg`: an optional photo per person, with the credit its licence requires.
- The site address: `PC_SITE_ORIGIN` in the Pages project and as a repository variable for the daily job, and `FEED_REPOSITORY` in the Pages project.

A copy does not change the tests. `npm test`, `npm run build:fixture`, and `npm run build:scale` read `fixtures/register.yaml`, a frozen copy of the first deployment's configuration that matches the synthetic records in `fixtures/`. So the tests pass whoever the copy covers.

A subject is anyone who makes public claims. The rules treat every person the same way, and the site never computes a score, ranking, or verdict on a person.

## Windows

A window is a date range of one publication to cover. A `rolling: true` window starts at `from`, and the daily update moves its `to`, and `retrieval_cutoff`, to the run date, so new posts are found. Claims are checked against evidence up to the date they were first checked (`scripts/lib/evaluation.ts`). A new register needs only one rolling window per publication.

The daily update finds and extracts posts only in rolling windows. A fixed window (no `rolling`) is for a back catalogue run by hand (`docs/running-a-corpus.md`).

Substack publications are listed from their public archive. Substack refuses GitHub's servers, so on the daily update its listing and post pages come through the site's own functions (`functions/feeds/`), and those read only `name.substack.com` addresses. A Substack publication on its own domain therefore does not work on the daily update yet. Ghost publications are listed from `sitemap-posts.xml`. Another kind of site needs its own listing in `scripts/discover.ts`.

## Decide the editorial policy

`policy/policy.yaml` and `docs/policy.md` are the rules: claim kinds, what can be scored, how confidence language is read, financial and hindsight rules, selection order, and quoting limits. They are written to be general. If you change a rule, bump the version and add a line to `changes`. Existing assessments keep the version they passed. `tests/policy.test.ts` keeps the code, the YAML, and the prose in step.

## Costs and limits

The daily update runs on a Claude subscription and a ChatGPT subscription, through their command-line tools. Reviews run with no shell and no tools, and a probe proves that fence before every run. ChatGPT drafts the evidence. Drafting may search the web and read pages, but only through a page reader that captures each page, so code can check every quotation (`scripts/mcp-read-page.ts`). Both providers review every claim. When a subscription hits its usage limit, the run keeps its finished work and continues the next day. `docs/running-a-corpus.md` has the measured rates from the first deployment and the lessons behind each design choice.

A hand-picked selection can instead run through the paid APIs, with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env` and a spend ceiling on every run. See `docs/operations.md`. Prices are in `ops/prices.yaml`.

## Private storage

Full post text, full quotations, drafts, and raw model answers never go to git. The daily update keeps them in a private Cloudflare R2 bucket named `robots-private`: the store as one bundle at `pundit/private-sources.tar.zst`, and the ChatGPT login at `logins/pundit/auth.json`. A new register starts with an empty store. From the first save on, the store is required: a run refuses to start without it, because a rebuild without it would drop claims. See `docs/adr/0002-private-source-retention.md` for what losing it means.

## What stays the same for everyone

Exact quotations checked by code against a captured copy of the source. Public excerpts capped per quote. Criteria frozen before grading. Two independent reviews from different providers and a final check of the public text by a provider other than the drafter's. A deterministic gate that holds anything missing, malformed, stale, or disputed, with the holds public. No grandfathered records. A correction and withdrawal path that cannot add a verdict.
