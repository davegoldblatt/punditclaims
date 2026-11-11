# Daily summary email from GitHub and a scheduled Claude routine

Pattern and gotchas from building the same morning email for three side projects in October and November 2026. Everything below was measured or tested. Names, repositories and accounts are removed.

## Shape

- A GitHub workflow gathers the facts with code and no model. It writes three files: `latest.md` (the facts in plain words), `latest.html` (the designed email, every number laid out, with two empty slots `<!--NOTE-->` and `<!--NEEDS-->`), and `latest.json` (the same facts as data). It also writes `snapshot.json`, which is the state the next run compares against.
- The workflow commits those files to an orphan branch such as `digest`. It uses a temporary `GIT_INDEX_FILE`, `read-tree` of the branch tip, `hash-object` and `update-index`, then `write-tree`, `commit-tree` and `push`. Main and the working tree are never touched. Put your host's skip marker in the commit message (Cloudflare Pages: `[CF-Pages-Skip]`) so the branch does not trigger a site build.
- A scheduled Claude routine in the cloud has the Gmail connector. It fetches the branch, writes only the note and a one-line "needs you" into the two slots, and sends the email. The model never lays out numbers. Design lives in code.
- The email comes from a cloud routine because headless `claude -p` on a laptop does not load claude.ai connectors such as Gmail (tested).
- Nothing is scheduled on the laptop. A closed lid means no email. Agent safety checks also refuse to install login items, so the owner would have to install them by hand.

## Timing: GitHub cron starts hours late

- Measured for a week on one personal account: a `12:07 UTC` cron started between 17:11 and 18:23 UTC. A `14:35 UTC` cron started between 18:40 and 19:46 UTC. A brand-new workflow's cron did not fire at all on its first day.
- A morning cron that runs shortly before the email will usually land after it.
- What works: gather just after local midnight, with a backup run four hours later. For Pacific time that is `10 8 * * *` and `10 12 * * *`. Avoid minute `0`.
- A scheduled run skips itself when today's facts (in local time) are already on the branch. Give manual runs a boolean input that runs the same check, so the skip path can be tested.

```yaml
on:
  schedule:
    - cron: "10 8 * * *"
    - cron: "10 12 * * *"
  workflow_dispatch:
    inputs:
      check_today:
        description: "Skip if today's facts exist, as a scheduled run does"
        type: boolean
        default: false
permissions:
  contents: write
concurrency:
  group: digest
  cancel-in-progress: false
jobs:
  gather:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Skip if today's facts already exist
        id: today
        if: github.event_name == 'schedule' || inputs.check_today
        run: |
          git fetch -q origin digest || { echo "skip=false" >> "$GITHUB_OUTPUT"; exit 0; }
          gen=$(git show FETCH_HEAD:digest/latest.json | jq -r .generated_at)
          have=$(TZ=America/Los_Angeles date -d "$gen" +%F)
          today=$(TZ=America/Los_Angeles date +%F)
          if [ "$have" = "$today" ]; then echo "skip=true" >> "$GITHUB_OUTPUT"; else echo "skip=false" >> "$GITHUB_OUTPUT"; fi
      # every later step: if: steps.today.outputs.skip != 'true'
```

- The routine must refuse facts that are not from today. If they are missing or old, it sends a short "no numbers this morning" email and stops. A loose freshness window such as "under 36 hours" quietly resends yesterday's facts as if they were today's.

## State between runs

- Keep the snapshot on the same orphan branch, not on a laptop disk. A fresh checkout then compares with the last email.
- In a fresh checkout every file has the checkout's modification time, so "modified since" filters pass everything. Filter on timestamps inside the records.
- Mention a section only when it changes. Sections that barely move, such as a headline verdict, are noise every morning. Store the last value in the snapshot and report only a change.

## Running other scripts from the gather

- Node: calling `process.exit()` straight after a lot of `console.log` output can drop output still queued for a pipe. A parent that reads through a pipe (`spawnSync`) then loses the last lines, often the summary line it parses. The symptom was intermittent empty output on a laptop and a failure every time on CI. Fix: let the script end on its own, or set `process.exitCode`.
- When a step's output does not parse, put its last non-empty lines and any exit code or signal into the email's notes. If you filter out noise lines first, check the filter cannot leave nothing.

## Data-centre addresses get blocked

- Substack returned HTTP 403 with an HTML page to GitHub's runners on both `/api/v1/archive` and `/feed`. The same requests worked from a home connection. A Ghost site's `/rss/` worked from GitHub.
- Before parsing, check the body has the expected format (for example `<rss` near the top). Report the failure plainly in the email, for example "the site sent a web page instead of its feed (HTTP 403)".
- Run the whole gather once on the runner before you trust it. A fresh checkout on your laptop does not catch IP blocks.
- A fix that works: if your site is on Cloudflare Pages, add a small Pages Function that fetches the feed from Cloudflare's network and returns only titles, dates and links as JSON. Restrict it to one host pattern (for example `^[a-z0-9-]+$` as a Substack subdomain), never an open URL, and cache it for 15 minutes. The gather tries the source first, then the feed, then your own endpoint. Substack answered Cloudflare's network with the feed.

## Cloudflare traffic numbers

- Token: a read-only user token with Account Analytics Read, Zone Analytics Read and Zone Read. You can pre-fill the token page: `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=<url-encoded JSON>&accountId=*&zoneId=all&name=<name>`, where the JSON is `[{"key":"account_analytics","type":"read"},{"key":"analytics","type":"read"},{"key":"zone","type":"read"}]`. Cloudflare drops unknown keys without a warning, so check the form before you create the token.
- With that token, `GET /accounts` returned an empty list. Take the account id from the zone instead: `GET /zones?name=<host>` gives `result[0].account.id`.
- Zone counts (`httpRequests1dGroups`) need no setup and include bots.
- Real visitors (`rumPageloadEventsAdaptiveGroups`):
  - Filter `requestHost_in: [host, www.host]`. Without it you get every site on the account.
  - Add `bot: 0`. Headless browser checks are counted otherwise.
  - Query at most about a week at a time. Longer ranges over recent data come back empty with no error.
- With "automatic setup", Cloudflare injects the counter only into pages it serves to real browsers. `curl` and scripts never see it, so checking the HTML from code says "off" when it is on. Check in a real browser, or check the site's policy.
- A strict Content-Security-Policy silently blocks the injected counter, and then almost no visits are counted. Allow `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com`. From code, treat real-visitor numbers as off until the live `content-security-policy` header allows `cloudflareinsights.com`.

## Secrets

- Move a secret from 1Password to the repository without printing it: `op read "op://<vault>/<item>/credential" | tr -d '[:space:]' | gh secret set NAME -R <owner>/<repo>`.

## Writing the note

- Write the facts file in plain words with no internal vocabulary. The model copies whatever words it sees.
- Give the routine a banned-word list and one example note with made-up numbers, and tell it never to copy the numbers.
- The note is two to four sentences: the one thing that matters most, what it means, and what to do. The "needs you" line is one sentence, or "Nothing today."
