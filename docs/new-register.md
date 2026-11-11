# Run your own register

This code is not specific to Gary Marcus and Ed Zitron. It records what any set of public figures said, what the statement commits them to, what dated evidence arrived, and what assessment the evidence supports, with two independent AI reviews and a code-decided publication gate. Everything that names the people lives in one configuration file and the data tree.

## 1. Copy the code, not the data

Fork or copy the repository, then start with an empty data tree:

```sh
rm -rf data/sources data/source-fetches data/occurrences data/claims data/contracts data/evidence \
       data/reviews data/assessments data/events data/invalidations data/releases data/activations \
       data/current-release.json research/coverage research/selection research/runs
```

Keep `policy/`, `docs/policy.md`, `src/`, `scripts/`, `tests/`, and `fixtures/`. The tests use synthetic records only.

## 2. Describe your register

Edit `config/register.yaml`:

- `site`: the name, the topic of the claims (for example `AI`, `climate`, `the economy`), a one-sentence description, the public repository that will receive disputes, the editor's name, a private contact address for takedown requests (or `null` until you have one), and optional provenance.
- `subjects`: one entry per person. Each has an `id` (a kebab-case slug), a `name`, the `publications` where their statements appear (origin URL, platform `substack`, `ghost`, or `generic`, and a short `prefix` for document ids), and the collection `windows` (date ranges you will cover, with a sentence on how posts are discovered).
- `retrieval_cutoff`: the last day of discovery.

Then add one file per person in `data/subjects/<id>.yaml` with a sourced one-line identification (copy the shape of an existing one). `npm run validate` checks that the subjects and windows match the configuration.

A subject is anyone who makes public claims. The rules treat every person the same way, and the site never computes a score, ranking, or verdict on a person.

## 3. Decide the editorial policy

`policy/policy.yaml` and `docs/policy.md` are the rules: claim kinds, what can be scored, how confidence language is read, financial and hindsight rules, selection order, and quoting limits. They are written to be general. If you change a rule, bump the version and add a line to `changes`; existing assessments keep the version they passed. `tests/policy.test.ts` keeps the code, the YAML, and the prose in step.

## 4. Credentials and costs

Reviews need two providers so no record is published on one model's say-so. Put `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env` (never committed). The reviewers run through the APIs with no tools. A full review of one record costs roughly $0.20 to $0.50 at list prices; every run takes a spend ceiling and stops before crossing it. Prices are in `ops/prices.yaml`.

## 5. Run it

Follow `docs/operations.md`: discover posts, freeze a selection, draft, ingest, review, release, build, promote. To grade every claim in a corpus on Claude and ChatGPT subscriptions instead of the APIs, follow `docs/running-a-corpus.md`. Read its lessons first. `npm run build:fixture` shows every page state with synthetic data before you have any records.

## What stays the same for everyone

Exact quotations checked by code against a captured copy of the source. Public excerpts capped per quote and per source. Criteria frozen before grading. Two independent reviews from different providers and a final check of the public text by a provider other than the drafter's. A deterministic gate that holds anything missing, malformed, stale, or disputed, with the holds public. No grandfathered records. A correction and withdrawal path that cannot add a verdict.
