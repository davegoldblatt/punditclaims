# Running a whole corpus

`docs/operations.md` describes the loop for a hand-picked selection: draft one claim, ingest it, review it through the APIs under a spend ceiling. This page describes the other way to run the same rules: every claim in every post, on the owner's Claude and ChatGPT subscriptions (the `claude` and `codex` command-line logins), with no per-token bill. The first deployment ran this way over 843 posts and 10,699 claims.

The editorial rules, the gate, and the public records are the same on both paths. Only the way the work is scheduled and paid for differs.

## The stages

Each stage reads what the earlier ones wrote, skips work that is already done, and can be stopped and restarted at any time.

1. `scripts/extract.ts` reads each captured post and lists candidate claims with the exact words.
2. `scripts/corpus.ts` turns candidates into claims and occurrences. Code re-checks every quotation against the captured text. It writes `research/corpus/ledger.jsonl`.
3. `scripts/screen.ts` asks both providers, per post, whether each claim is attributed correctly, whether its normalised proposition is faithful, whether its kind is right, and whether it can be checked at all. `scripts/screened.ts` sorts the answers. A claim both providers find uncheckable publishes as "Can't be checked" with text composed by code. A claim they disagree on goes to the fix round. A doubt about attribution holds the claim.
4. `scripts/fix.ts` runs one correction round. The result is revision 2 of the claim with its reason, and it is screened again. A claim still read differently after the round is held.
5. `scripts/grade.ts` drafts the evidence and a proposed assessment for each checkable claim. Drafters use web search and `scripts/mcp-read-page.ts`, a page reader that captures each page it reads, so code can check every quotation in the evidence. Workers from both subscriptions share one queue.
6. `scripts/review-batch.ts` gets two independent reviews per claim, several claims to a call. Each answer is bound to its own case, and the gate takes exactly one answer per claim. When both reviews agree with the draft, the provider other than the drafter's checks the public text. The gate then decides.
7. `scripts/revise.ts` runs one rewrite of the public text when the two reviews agree with each other but not with the draft, or when the final check found that the text says more than the evidence. The assessment is always the reviewers'. Only the wording changes.
8. `scripts/release.ts`, `npm run build`, and `scripts/promote.ts`, as in `docs/operations.md`.

`zsh scripts/drive.sh` keeps all of this moving. Every 15 minutes it records new extractions, sorts screened claims, and restarts any stage that has finished. Logs go to `.runs/`.

## The daily update

`.github/workflows/update.yml` runs the same stages once a day on GitHub, on the owner's personal subscriptions, with nothing on the Mac (DAV-467):

1. `scripts/roll-windows.ts` moves every `rolling: true` window, and `retrieval_cutoff`, to the run date. Existing claims keep the date they were first checked against (`scripts/lib/evaluation.ts`); only new claims use the new date.
2. Discovery and capture for the rolling windows. Substack refuses GitHub's runners, so with `PC_SUBSTACK_VIA` its listing and public post pages come through the site's own functions (`functions/feeds/substack-archive`, `functions/feeds/substack-post`).
3. Extract, screen, fix, grade, review, rewrite, probable calls (`scripts/ci/update.sh`). Each stage skips finished work, so a quiet day costs almost nothing and a stage stopped by a usage limit continues the next day.
4. Commit. A release (about 50 MB) only when assessments, events, or claims changed.

Logins and private data live in a private Cloudflare R2 bucket, `robots-private`: the private store as one bundle, `pundit/private-sources.tar.zst` (the previous one kept as `.prev`; a per-file copy from the first upload sits under `pundit/private-sources/`), and the robot's own ChatGPT login under `logins/pundit/`. The login refreshes itself about every ten days and its old refresh token dies once used, so every run saves it back (`scripts/ci/codex-login.sh`). Claude uses the owner's subscription token (`CLAUDE_CODE_OAUTH_TOKEN`). The run refuses to start if the private store has fewer extractions than the ledger has extracted posts.

## Lessons

Each of these cost real time or real subscription quota on the first run. The code now does the right thing, and this list says why, so a new register does not learn them again.

**Never throw away a paid answer.** The Claude CLI exits before a pipe drains. Read through a pipe, every answer longer than 8 KB arrived cut off, and in one night 217 of 294 Claude drafting answers were lost. `scripts/lib/subscription.ts` now reads CLI output from a file. Any answer that still cannot be read is kept in private storage, so it can be recovered rather than bought again.

**Never throw away a good review.** A retry used to ask both providers again when only one had failed. `scripts/review-batch.ts` now reuses the good answer when it is still bound to the same case and prompt, and asks only the provider that failed.

**A usage limit is not a result.** When a subscription hits its limit, record nothing, put the work back on the queue, and stop that provider's workers until the limit resets. They try again every 10 minutes. Before this, the limited workers took every batch from the shared queue and skipped it, so each run drafted about 20 of 1,380 batches. Limit messages change their wording ("You've hit your 5-hour limit · resets 6:30pm"), so the check matches broadly.

**Spend the scarce subscription where it is required.** Reviews need both providers. Drafting needs one. Claude's 5-hour limit was the bottleneck, so ChatGPT drafts alone and Claude's quota goes to reviews.

**Screen before you grade.** A third of the claims (3,579 of 10,699) were value judgements, rhetoric, or claims with no plain reading. A screen costs far less than a researched draft, and those claims still publish, marked as unscorable.

**Fix once, then hold.** One correction round settles most claims the screens read differently. A claim still split after it is held, not argued over again. The one exception is a held claim whose verdict is already settled and whose hold more work can fix: a failed wording check, or criteria a reviewer found unfair to the speaker. It gets one more pass through the same gate (docs/adr/0005).

**Rewrite the text, never the verdict.** Reviewers often agreed with each other and not with the draft. One rewrite to their assessment raised the share of graded claims that publish from about 12% to about half.

**Cap retries on outcomes, not attempts.** Three drafting attempts per claim, three assessments per evidence packet, one fix, one rewrite. An uncapped retry spends quota forever on a claim that cannot pass.

**Batch with a binding per claim.** Four claims to a call cuts the number of calls by about four. Each answer carries its own case digest, so the gate still checks every claim on its own and an answer can never count for the wrong claim.

**Syndicated stories share text.** Two documents can carry the same text hash. Version lookups key on the document and the hash together.

**Load the store once.** At 10,000 claims a reload takes about two seconds. Load once per batch and pass it through. Ingest one batch at a time: with two dozen workers each holding its own copy of the store, grading ran out of memory twice on 2026-10-29.

**Use a page reader you control.** A fetch tool that summarises pages cannot support an exact quotation.

**Run the CLIs clean.** `claude -p --safe-mode` also turns off MCP servers. Research calls therefore drop safe mode and keep `--setting-sources ""`, `--strict-mcp-config`, and an explicit tool list, so the owner's CLAUDE.md, memory, and hooks never reach the prompt. `scripts/probe-subscription.ts` checks this. `codex exec` needs `default_tools_approval_mode="approve"` for MCP tools and keeps code mode on for tool calls to work.

**Normalise dates in code.** Models return event dates as ranges. Providers strip regular-expression patterns from output schemas, so the code reduces each date to one day.

**Check the site with its real headers.** The site's Content-Security-Policy blocks inline style attributes. The local preview does not send that header, so bar widths set inline looked right there and collapsed to thin stripes on the live site. `npm run build` now fails on any inline style.

**Keep the machine awake.** A laptop closed on battery sleeps and pauses every stage. Run on mains power with the lid open, or on a server.

## Measured on the first run (2026-10-28 and 29)

843 posts: 681 with claims, 84 with none, 74 that could not be read. 10,699 claims: 3,579 uncheckable, 5,985 sent to grading, 953 still read differently after the fix round, 182 held on attribution. Twenty ChatGPT drafting workers produced about 300 to 500 drafted claims an hour. Claude reviewed roughly 1,000 to 1,200 claims in each 5-hour window.
