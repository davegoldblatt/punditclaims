# Pundit Claims

A source-backed public register of AI claims by Gary Marcus and Ed Zitron: what was said, what the statement commits the speaker to, what dated evidence arrived, what assessment that evidence justifies, and what changed afterwards.

It is a curated register, not a rating of anyone. There is no accuracy score. The editorial rules are in `docs/policy.md`.

## Set it up for other pundits

You can run this same register for anyone whose newsletter is on Substack at a `name.substack.com` address, or on Ghost. Setup is nine steps. After that it runs by itself once a day.

You need:

- a GitHub account,
- a Cloudflare account, for the site and for private storage,
- a Claude subscription and a ChatGPT subscription (the daily job runs on them, so there is no per-token bill),
- on your computer: Node 22.18 or newer, and the `gh`, `claude`, and `codex` command-line tools, with `gh` signed in (`gh auth login`).

### 1. Copy the code without the data

```sh
git clone --depth 1 https://github.com/davegoldblatt/punditclaims.git my-register
cd my-register
rm -rf .git data research/corpus research/coverage research/legacy-manifests research/runs research/selection \
       public/people/* .github/workflows/digest.yml
mkdir -p data/subjects
npm ci
```

The download is large because it includes this register's records. The `rm` line deletes them, along with this register's photos and its morning email. Keep `research/prompts/`. Those are the prompts.

### 2. Name your pundits

```sh
cp config/register.example.yaml config/register.yaml
cp config/subject.example.yaml data/subjects/jane-doe.yaml
```

Open both files and replace the example values. Each field has a comment.

- `config/register.yaml` holds the site's name and topic, and one entry per person: their newsletter and the date to start from. Set `repository` to the GitHub address you will create in step 4.
- `data/subjects/<id>.yaml` is one short file per person. Rename the copy to match the person's `id`, and copy it again for each extra person.

Start a few months back. Each daily run continues where the last one stopped, so a longer back catalogue only takes more days.

### 3. Check it

```sh
git init -b main && git add -A && git commit -m "My register"
npm test && npm run validate && npm run build
npm run preview
```

The tests run on synthetic records, so they pass whoever you chose. The preview shows your site, still empty.

### 4. Put it on GitHub

```sh
gh repo create my-register --public --source . --push
```

Make it public, so readers can open disputes from claim pages. The daily run fails until step 8 is done. That is harmless.

### 5. Make the site

In the Cloudflare dashboard, create a Pages project from your GitHub repository:

- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables:
  - `PC_SITE_ORIGIN`: the site's address, for example `https://my-register.pages.dev` or your own domain.
  - `FEED_REPOSITORY`: your repository as `owner/name`. Substack blocks GitHub's servers, so the daily job reads Substack through your site. This makes the site serve only your job.

### 6. Make private storage

Full post text and the ChatGPT login stay in private storage, never in git.

1. In Cloudflare, go to R2 and create a bucket named `robots-private`. The daily job uses that name. R2 may ask for a card first. A register this size stays inside the free allowance.
2. Create an R2 API token with Object Read & Write on that bucket. Keep its Access Key ID, its Secret Access Key, and the S3 endpoint, `https://<account-id>.r2.cloudflarestorage.com`.

### 7. Log in the two subscriptions

Claude: run this and copy the token it prints.

```sh
claude setup-token
```

ChatGPT: make a separate login for the daily job, upload it, then delete your local copy.

```sh
(
  export CODEX_HOME="$(mktemp -d)"
  codex login --device-auth        # approve it with your ChatGPT account
  npx wrangler login
  npx wrangler r2 object put robots-private/logins/pundit/auth.json --file "$CODEX_HOME/auth.json" --remote
  rm -rf "$CODEX_HOME"
)
```

The daily job saves the login back after every run, because it renews itself about every ten days.

### 8. Give GitHub the keys

```sh
gh secret set CLAUDE_CODE_OAUTH_TOKEN    # the token from step 7
gh secret set R2_ACCESS_KEY_ID
gh secret set R2_SECRET_ACCESS_KEY
gh secret set R2_ENDPOINT
gh variable set PC_SITE_ORIGIN --body "https://my-register.pages.dev"
```

Each `gh secret set` asks you to paste the value. Use the same site address as in step 5.

### 9. Run it

On GitHub, open Actions, then "daily update", then "Run workflow".

1. Run it once with mode `check`. It tests the logins, the storage, and finding posts, with one small call to each subscription. It saves nothing. If it fails, the log says which step and why.
2. Run it with mode `full`.

From then on it runs once a day. Each run finds new posts, pulls out the claims, has Claude and ChatGPT check them independently, and publishes when something a reader would see has changed. A run that hits a subscription limit keeps its finished work and continues the next day. Your first claims appear after the first run that gets claims through both checks.

### Good to know

- A Substack newsletter on its own domain does not work yet. Substack blocks GitHub's servers, and your site can only pass on pages from `name.substack.com` addresses. Another kind of site needs its own way to list posts in `scripts/discover.ts`.
- The editorial rules are general and work for any topic. Read `docs/new-register.md` before you change one.
- If a run says the ChatGPT login is missing or has no refresh token, redo the ChatGPT part of step 7.

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
