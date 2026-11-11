# Plan: the full corpus, processed locally on subscriptions (v2)

Status: v2, 2026-10-28, after the cross-vendor audit of v1 (verdict: rework before build; 17 findings) and the owner's decisions. v1 is in git history.

## Owner decisions
- Every claim in the corpus, not a curated 40: all of Gary Marcus's posts (474 in the legacy window, 124 since) and all of Ed Zitron's free posts since 2023 (about 180).
- The initial build runs on the owner's Claude and ChatGPT subscriptions. The paid APIs are for ongoing work.
- Every claim shows the speaker's full words (policy .5: excerpts up to 80 words, no per-source cap).
- The owner accepts that the subscription route for OpenAI uses a client that holds his ChatGPT login; the mitigation below must hold, and is re-proved after any client upgrade.

## What changed from v1, by audit finding
- F1 (blocker, Codex route could read its own login): instead of an outer sandbox, the Codex client runs with its shell and every other tool feature disabled and web search off, plus a read-only sandbox, and its event log is checked so any tool use refuses the answer. `scripts/probe-subscription.ts` plants a canary file and a hostile instruction; it passed on 2026-10-28 for both clients (nothing ran, nothing leaked, no owner memory seen). It is rerun before every bulk run and after any client upgrade; a failure stops the run.
- F2 (Claude isolation): `claude -p --safe-mode --tools "" --strict-mcp-config` with an empty MCP config, no setting sources, no session persistence, no slash commands, minimal environment. The probe confirmed the reviewer sees only the account email the client always attaches.
- F3 (lighter review dropped semantic checks): no lighter track. Every record gets the same two reviews and the final-text check. Unscorable claims simply have no evidence search.
- F4, F5 (quoting option A): moot. Policy .5 quotes every claim in full.
- F6 (release size): fixed. Releases may be up to 64 MB; single records stay at 256 KB.
- F7 (binding): fixed. Reviews and final checks are bound to a digest of the whole case: claim, contract, packet, every statement receipt, policy version, prompt. All earlier reviews were redone on the subscriptions.
- F8 (no proof every item was processed): a corpus ledger, one line per post, per extraction candidate, and per legacy row, each ending in a disposition (claim id, merged into, rejected with reason, zero claims, inaccessible, failed). Coverage pages and completion checks are derived from it. A run is complete only when every ledger line has a disposition.
- F9 (routing): an exhaustive routing table, in policy, with precedence. Only medium or low graded confidence and probability language is unscored; high confidence is scored. Reviewers confirm the routing; an unresolved classification is held, never silently routed.
- F10 (merging): a normalised commitment record per candidate (proposition, polarity, modality, predicate, target and version, threshold, metric, conditions, observation period, absolute horizon). A merge is refused on any material difference; uncertain merges stay separate and linked.
- F11 (recall): extractor agreement is reported as agreement, not recall. Recall is estimated from an independent second extraction of a stratified sample of whole posts (by subject and length, including posts where the first pass found nothing), adjudicated, with the matching rule, misses, and false positives published.
- F12 (workload estimate unsupported): measure first. A 50-claim sample across both authors and all record types sets the time and usage estimates before the bulk run.
- F13 (budget concurrency): subscription calls are limited by count and time; API calls must reserve tokens and spend before dispatch. Fix before any API bulk run.
- F14 (resume): reviews and assessments are already durable files. A resumed run skips claims whose latest assessment already passes with bound reviews and redoes only missing stages.
- F15 (equivalence): the 35 records reviewed on the API were re-reviewed on the subscriptions under the same policy, schema, and prompts. Agreement and every difference are reported before scale (see section 4).
- F16 (freeze order): contracts are frozen at ingest, before any review sees the case. The drafter writes the contract with the evidence in view, so these records are labelled retrospective, as they already are.
- F17 (archives): archive copies are fetched only where wording or timing matters to the assessment, with the capture date recorded and shown.

## Pipeline
1. Capture every post in every window (safe fetcher), recording access state. Ledger line per post.
2. Extraction by Claude agents on the subscription, about 15 posts per batch, from captured text with a fixed, versioned brief. Every quotation is located by code; non-matching quotations are rejected. Ledger line per candidate.
3. Commitment records and merging under F10. Repeats become occurrences of one claim.
4. Routing under F9: evidence track or no-evidence track.
5. Evidence by theme for the evidence track: one search serves many claims; captured sources are reused by hash.
6. Ingest (contract frozen, packet sealed), then two reviews and the final-text check on the subscriptions, paced, resumable.
7. Holds: a drafting error is fixed once and re-reviewed; a genuine split stays held.
8. Release, then a cross-vendor audit of the release before anything is public.

## Order of work
1. Subscription route and probe (done), equivalence re-review (running).
2. Corpus ledger, routing table, commitment records (code and tests).
3. Capture the legacy window.
4. 50-claim measured sample; decide pacing.
5. Extraction of every post, recall sample, merging, routing.
6. Evidence and reviews in paced batches.
7. Release and audit.

## Risks
- Subscription usage limits are unpublished rolling windows; runs must pace, checkpoint, and resume.
- Client behaviour can change on upgrade: client versions are recorded with each run report and the probe gates every run.
- Automated bulk use of consumer subscriptions may be limited by either provider's terms; the owner accepts this risk for the initial build.
- Full quotations of short posts raise a fair-use question; the owner has decided to quote in full.
- Selecting the whole corpus does not remove all selection effects: extraction, merging, and routing still shape what is scored. The method page will say so.
