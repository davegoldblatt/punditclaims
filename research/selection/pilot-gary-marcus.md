# Pilot selection: Gary Marcus

Frozen 2026-10-28, before any outcome evidence was looked up. Policy version `2026-10-28.2`.

This is a feasibility pilot, not the full cohort. It does not replace the frozen inventory in `research/selection/gary-marcus.json` that policy section 3 requires.

## How the list was made

1. Pool A (matured dated forecast): every legacy row typed `predictive` whose legacy horizon (`explicit_date` or `relative`) ends on or before 2026-10-28. 61 rows. `claim_0962` is excluded because it is already drafted (`gm-gpt-5-not-in-2024`).
2. Pool B (open dated forecast): every legacy row typed `predictive` whose legacy horizon ends after 2026-10-28. 24 rows.
3. Each pool is sorted by `sha256("2026-10-28.2" + legacy id)`, as policy section 3 sets out.
4. One filter on wording only, applied before any outcome lookup: rows whose legacy quotation is hedged ("could", "may", "might", "likely") are passed over in favour of firm wording, because the lead asked for firm forecasts. Passed over in Pool A on this ground: `claim_0272` ("could"), `claim_0876` ("could"), `claim_1270` ("may well"). No row was passed over for any other reason.
5. Taken in hash order: the first 7 firm rows of Pool A and the first 3 firm rows of Pool B.
6. Two declared leads from the plan (doc-2, section 5), chosen for kind coverage (one normative, one observation), not by outcome.
7. The legacy horizons and the legacy "elapsed" labels are not trusted. Each deadline below is the legacy record's reading and is checked against the live post during drafting. A correction is noted below the list and does not change membership or order.

## Candidates, in priority order

| # | Candidate | Stratum | Exact words (legacy record, to verify) | Why it qualifies | Deadline as stated (to verify) |
|---|---|---|---|---|---|
| 1 | `claim_0969` (the-great-ai-retrenchment-has-begun, 2024-06-22) | matured-dated-forecast | "Expect more revisionism and downsized expectations throughout 2024 and 2025." | Firm imperative "Expect", explicit years. Hash key 08912a262b50. | "throughout 2024 and 2025", so 2025-12-31 |
| 2 | `claim_1264` (25-ai-predictions-for-2025-from-marcus, 2025-01-01) | matured-dated-forecast | "Technical moat will continue to be elusive. Instead, there will be more convergence on broadly similar models, across both US and China" | Firm "will", annual prediction list for 2025. Hash key 0a572e882927. | end of 2025 (post framing) |
| 3 | `claim_0834` (10-million-says-we-wont-see-human, 2024-04-09) | matured-dated-forecast | "I don't buy the predictions for the next year" | Rejects a dated forecast of human-superior AGI by end of 2025. Hash key 0efb1e9c1ba3. | end of 2025 (the rejected prediction's horizon) |
| 4 | `claim_0849` (superhuman-agi-is-not-nigh, 2024-04-14) | matured-dated-forecast | "Learn and master the basics of almost any new video game within a few minutes or hours, and solve original puzzles in the alternate world of that video game." | Listed task tied to an end-of-2025 horizon. Hash key 13fdf3677b66. | end of 2025 |
| 5 | `claim_1268` (25-ai-predictions-for-2025-from-marcus, 2025-01-01) | matured-dated-forecast | "Sora will continue to have trouble with physics" | Firm "will", 2025 prediction list. Hash key 15044ea8bb22. | end of 2025 (post framing) |
| 6 | `claim_1261` (25-ai-predictions-for-2025-from-marcus, 2025-01-01) | matured-dated-forecast | "Copyright lawsuits over generative AI will continue throughout the year" | Firm "will", "throughout the year". Hash key 1996c60a571f. | "throughout the year", so 2025-12-31 |
| 7 | `claim_0808` (when-will-the-genai-bubble-burst, 2024-03-31) | matured-dated-forecast | "If hallucinations were brought down to human expert levels by the end of 2024 I would be truly astonished." | Firm expectation framed as astonishment, explicit date. Hash key 1c7c2d9913c1. | "by the end of 2024" |
| 8 | `claim_2053` (the-possibly-coming-ai-backlash-and, 2026-01-06) | open-dated-forecast | "The giant AI infrastructure plays (like Project Stargate) that he championed after his inauguration will look like an unprofitable and underused mistake." | Firm "will", end-of-2026 horizon. Hash key 137666571bc1. | end of 2026 |
| 9 | `claim_2055` (the-possibly-coming-ai-backlash-and, 2026-01-06) | open-dated-forecast | "Generative AI, once Silicon Valley's golden child, will start to look like a fad, a solution in search of a problem with economics that don't add up." | Firm "will", 2026 horizon. Hash key 31f81197c28c. | 2026 |
| 10 | `claim_1565` (dear-elon-musk-here-are-five-things; legacy date 2025-04-17, plan says 2022-05-31) | open-dated-forecast | "In 2029, AI will not be able to reliably construct bug-free code of more than 10,000 lines from natural language specification or by interactions with a non-expert user" | Firm "will not", explicit year. Also a declared lead. Hash key 3479c1c2c75e. | 2029 |
| 11 | https://garymarcus.substack.com/p/we-must-recall-open-ended-ai-agents (2026-10-10) | declared-lead | Title: "We must recall open-ended AI agents with internet access from the market, now". Exact sentence to be taken from the post. | Declared lead. Normative kind. Hash key 179ce8d40fac. | none (recommendation) |
| 12 | https://garymarcus.substack.com/p/hot-take-on-gpt-6-astra (2026-09-03) | declared-lead | Exact sentence on Astra's robustness to be taken from the post. | Declared lead. Observation kind. Hash key fd8b4d63bf04. | none (observation) |

## Drafting notes (added after freeze; membership and order unchanged)

- 2026-10-28, candidate 3 (`claim_0834`): the claim rests on two posts. "I don’t buy the predictions for the next year" (2024-04-09) and the restated bet "AGI superior to the smartest individual humans would not arrive by the end of 2025" in `superhuman-agi-is-not-nigh`. Both are drafted as occurrences of one claim.
- 2026-10-28, candidates 2 and 5 (`claim_1264`, `claim_1268`): in the live post both sit under the heading "Medium confidence". Candidate 6 (`claim_1261`) sits under "High confidence". The legacy rows do not record these headings.
- 2026-10-28, candidate 4 (`claim_0849`): the live wording is "things that ordinary people do that I seriously doubt AI will be able to do by the end of 2025", and the post adds "I could be wrong on a few in the lists above". The hedge is in the source, so the candidate is not firm.
- 2026-10-28, candidates 8 and 9 (`claim_2053`, `claim_2055`): the live post introduces them as Politico's "Black Swan" feature, "on unlikely scenarios that could nonetheless come true". The legacy rows read them as firm forecasts. The horizon "By the end of 2026" governs the whole scenario paragraph.
- 2026-10-28, candidate 10 (`claim_1565`): the live post says it was edited ("later clarification, italics added June 2024"). A Wayback copy near 2022-06-01 contains the same sentence. The fetcher labelled that copy `public_preview`, so it cannot serve as full context.
- ERRATA, 2026-10-28: two sealed claim revisions carry a wrong statement date that I copied from the legacy rows. `gm-expect-revisionism-2024-2025` says "written 2024-06-22", but the post's publication date is 2024-06-15 (JSON-LD datePublished); 22 June 2024 is the date of the update at its top. `gm-no-superhuman-ai-by-end-2025` says "2024-04-14" for the second post, but its publication date is 2024-04-12. The occurrences carry the correct dates. The claim text and the horizon start in contract version 1 of the first claim need a correction revision. I did not hand-edit sealed records.
- 2026-10-28: the policy moved from `2026-10-28.2` to `2026-10-28.3` during drafting. The hash order above was computed with `2026-10-28.2` and is not recomputed, because the list froze before any outcome lookup. Under `.3` the order would differ. Under `.3`, a confidence heading about a definite outcome ("Medium confidence ... will") is scored.
- 2026-10-28: legacy dates were wrong for 3 of the 9 posts read. `dear-elon-musk-here-are-five-things` was published 2022-05-31 (legacy 2025-04-17), `the-great-ai-retrenchment-has-begun` on 2024-06-15 (legacy 2024-06-22), and `superhuman-agi-is-not-nigh` on 2024-04-12 (legacy 2024-04-14).

## Dispositions (2026-10-28)

| # | Candidate | Claim id | Disposition | Proposed outcome |
|---|---|---|---|---|
| 1 | `claim_0969` | `gm-expect-revisionism-2024-2025` | Clean ingest. Contract v2 under `.3`. Claim text carries the wrong statement date (see errata). | not_adjudicable, axis not_applicable: no actor, measure, or threshold |
| 2 | `claim_1264` | `gm-moat-convergence-2025` | Clean ingest under `.2` only. The sealed modality `likely` follows the `.2` reading of "Medium confidence". Under `.3` the claim needs a revision to `will` and a new contract. A draft cannot revise a claim, so it is left for the editor. | not_adjudicable under `.2` (probabilistic heading, no measure for "moat") |
| 3 | `claim_0834` | `gm-no-superhuman-ai-by-end-2025` | Clean ingest. Contract v2 under `.3`. Claim text carries a wrong date for the second post (see errata). | supported: ARC-AGI-2, 5 Dec 2025, best verified AI 37.6% and 54%; every task solved by at least two people |
| 4 | `claim_0849` | `gm-video-game-mastery-by-end-2025` | Clean ingest under `.3`. | not_adjudicable: the post says "Some items might get checked off by the end of 2025" |
| 5 | `claim_1268` | `gm-sora-physics-trouble-2025` | Clean ingest under `.3`. | supported: OpenAI's Sora 2 launch post (30 Sep 2025) says the model is "still imperfect" at obeying physics. Company disclosure only. |
| 6 | `claim_1261` | `gm-copyright-suits-continue-2025` | Clean ingest under `.3`. | supported: S.D.N.Y. complaint (13 Feb 2025) and ruling (13 Nov 2025: "more than fifty lawsuits") |
| 7 | `claim_0808` | `gm-hallucinations-expert-level-2024` | Clean ingest under `.3`. | unresolved: no source measures human-expert error rates on the same tasks |
| 8 | `claim_2053` | none | Not drafted: time box. The source frames it as a Politico "Black Swan" entry, "unlikely scenarios that could nonetheless come true". | expected not_adjudicable, not_due |
| 9 | `claim_2055` | none | Not drafted: time box. Same framing as #8. | expected not_adjudicable, not_due |
| 10 | `claim_1565` | `gm-no-10k-line-bugfree-code-2029` | Clean ingest under `.3`. Prospective. | unresolved, not_due |
| 11 | we-must-recall-open-ended-ai-agents | `gm-recall-open-ended-agents` | Clean ingest under `.3`. | not_adjudicable, normative |
| 12 | hot-take-on-gpt-6-astra | none | Not drafted: time box. The post's footnote calls the whole take "VERY tentative". The robustness sentence ("What we don’t know is how robust that capability is.") is a statement about what is known. It would need a defined test or be recorded as too open to test. | not drafted |

## Round 2 extension (frozen 2026-10-28, before any outcome lookup for the rows below)

The order continues from the round-1 list. Candidates not yet drafted come first (#8, #9, #12). The list then extends Pool A (matured dated forecast) in the same order, sha256("2026-10-28.2" + legacy id), from the first row after round-1 candidate 7 (`claim_0808`, Pool A position 8). Pool A was recomputed from the legacy file with the round-1 rule and gives the same order and hash keys as round 1 for positions 1 to 8 (62 rows including `claim_0962`).

Wording filter, as in round 1, applied to wording only and before any outcome lookup:

- A legacy quotation that contains "could", "may", "might", or "likely" (including "unlikely") is passed over.
- Rows from the list in `superhuman-agi-is-not-nigh` are passed over: round 1 established from the live text that the dated list is introduced with "I seriously doubt" and followed by "Some items might get checked off", and the second list ("things that some of the most skilled humans are able to do") carries no date and ends "None seem to me to be within immediate reach". This is the same hedge found for candidate 4. It was found from the source wording, not from any outcome.
- A row that repeats a proposition already in the list is drafted once, as an occurrence of the earlier claim, and is not counted twice.

| # | Pool A pos. | Candidate | Hash key | Legacy words (to verify) | Disposition before drafting |
|---|---|---|---|---|---|
| 13 | 9 | `claim_1776` (ai-agents-have-so-far-mostly-been, legacy 2025-08-03) | 1d222cb2b0b8 | "AI 'Agents' will be endlessly hyped throughout 2025 but far from reliable, except possibly in very narrow use cases" | take; same proposition as `claim_1256` (Pool A pos. 38), drafted once |
| - | 10 | `claim_0876` | 1f938cca78af | "could" | passed over in round 1 (wording) |
| - | 11 | `claim_0850` | 246905e83ef5 | superhuman-agi-is-not-nigh list | passed over (wording, see above) |
| 14 | 12 | `claim_1655` (the-ai-2027-scenario-how-realistic, legacy 2025-05-22) | 25d434df0730 | "If 'great' AI research agents don't arrive by the end of 2025, everything in the rest of the essay gets moved back." | take |
| - | 13 | `claim_1270` | 2d3fb0c1748e | "may well" | passed over in round 1 (wording) |
| 15 | 14 | `claim_0996` (alphaproof-alphageometry-chatgpt, legacy 2024-07-28) | 2ddf7ebd5bf4 | "I fully expect that the generative AI bubble will begin to burst within the next 12 months" | take |
| 16 | 15 | `claim_0368` (what-if-generative-ai-turned-out, legacy 2023-08-13) | 32f937e2b30e | "I seriously doubt it. We have not one, but many, serious, unsolved problems at the core of generative AI" | take |
| - | 16 | `claim_0853` | 3a498167d95b | superhuman-agi-is-not-nigh list | passed over (wording, see above) |
| - | 17 | `claim_0632` | 3a98c371ce25 | "likely" | passed over (wording) |
| - | 18 | `claim_1307` | 3d1e2ffa3bc8 | "might" / "may well" | passed over (wording) |
| 17 | 19 | `claim_0817` (when-will-the-genai-bubble-burst, legacy 2024-03-31) | 3efe172f3e41 | "If nobody (OpenAI, Google, or anyone else) releases a true quantum leap by the end of 2024, ..." | take |
| 18 | 20 | `claim_1265` (25-ai-predictions-for-2025-from-marcus, 2025-01-01) | 434c7f0c1fc9 | "Few companies (and even fewer consumers) will adopt o3 at wide scale ..." | take |
| - | 21 | `claim_0852` | 48190cef998a | superhuman-agi-is-not-nigh list | passed over (wording, see above) |
| 19 | 22 | `claim_0749` (no-rag-is-probably-not-going-to-rescue, legacy 2024-02-24) | 4882f845dbe9 | "Imagining perfectly reliable, hallucination-free chatbots by this time next year is bonkers." | take |
| 20 | 23 | `claim_1759` (deepmind-and-openai-achieve-imo-gold, legacy 2025-07-22) | 55e950418466 | "Eric Schmidt's recent prediction ... 'world-class mathematicians' within a year, is pure fantasy." | take |
| 21 | 24 | `claim_1254` (25-ai-predictions-for-2025-from-marcus) | 56b1f840803a | "Hallucinations ... will continue to haunt generative AI" | take |
| 22 | 25 | `claim_1255` (25-ai-predictions-for-2025-from-marcus) | 66e90768a630 | "Reasoning flubs will continue to haunt generative AI" | take |
| 23 | 26 | `claim_1258` (25-ai-predictions-for-2025-from-marcus) | 6a7bce798f6a | "OpenAI will continue to preview products months and perhaps years before ..." | take |

Drafting goes in this order (#8, #9, #12, then #13 onward) until the round's time box or spend limit. A row not drafted is marked "not drafted: time box", never dropped for its outcome. The quoting cap (150 words or 10% per source) may stop a row from publishing; that is recorded as such. Newer 2026 posts in this round: `the-possibly-coming-ai-backlash-and` (2026-01-06, #8 and #9) and `hot-take-on-gpt-6-astra` (2026-09-03, #12).

Correction, 2026-10-28 (round 2, before any outcome lookup for this row): #17 `claim_0817` was marked "take" from a truncated print of the legacy quotation. The full legacy quotation ends "the bubble may start to pop by this time next year", so the wording filter passes it over. The live post has the same "may".

## Round 2 dispositions (2026-10-28)

Round-1 held records, one more review round each:

| Claim id | Change | Gate |
|---|---|---|
| `gm-sora-physics-trouble-2025` | Claim revision: modality `likely`, proposition carries the "Medium confidence" heading. Outcome not_adjudicable; OpenAI's Sora 2 statement kept as context. | published |
| `gm-video-game-mastery-by-end-2025` | Claim revision: proposition mirrors "I seriously doubt", keeps "master" and "a few". Policy-version text removed. | published |
| `gm-no-10k-line-bugfree-code-2029` | Removed the unsupported sentence about an archived copy. Contradiction condition now counts a capability shown before 2029 that is available in 2029. | published |
| `gm-moat-convergence-2025` | Claim revision: proposition mirrors "elusive" and "more convergence". Public text no longer mentions our tools. | held: the final-text check objected to `what_would_resolve` ("would be scored" promised too much). Drafting error, not fixed: the one extra round is used. |
| `gm-expect-revisionism-2024-2025` | Contract moved to axis forecast_outcome, interpretation decides result; author's 22 June update added as context. | held: both reviews say not_adjudicable, but OpenAI uses axis not_applicable and Anthropic forecast_outcome. |
| `gm-hallucinations-expert-level-2024` | Proposed not_adjudicable: no task, domain, or measure for "human expert levels". Removed the unsupported benchmark sentence. | held: same axis split as above. |

New records (selection order):

| # | Candidate | Claim id | Proposed | Gate |
|---|---|---|---|---|
| 8 | `claim_2053` | `gm-stargate-unprofitable-mistake-2026` | not_adjudicable, not_due (Politico "Black Swan" scenario) | published |
| 9 | `claim_2055` | none | not drafted: this short post (about 282 words) allows about 28 quoted words, and #8 uses 22 | not drafted (quoting cap) |
| 12 | hot-take-on-gpt-6-astra | `gm-astra-open-ended-task-problems` | not_adjudicable, open_horizon ("I suspect", "VERY tentative") | published |
| 13 | `claim_1776` / `claim_1256` | `gm-agents-hyped-unreliable-2025` | supported | held first (OpenAI: partial-year evidence for a full-year forecast); contract tightened to require late-2025 evidence, two October 2025 items added; then published |
| 14 | `claim_1655` | `gm-ai2027-research-agents-moved-back` | not_adjudicable (conditional, antecedent unknown) | held: horizon split, Anthropic elapsed, OpenAI open_horizon |
| 15 | `claim_0996` | `gm-genai-bubble-begin-burst-12-months` | not_adjudicable, axis not_applicable | no assessment recorded: both reviews said not_applicable/elapsed, which the schema refuses for that axis |
| 16 | `claim_0368` | `gm-doubt-agi-in-2-3-years-2023` | not_adjudicable ("I seriously doubt it") | held first (my limitation wrongly said the post does not define AGI); fixed once; then published |
| 17 | `claim_0817` | none | passed over (wording: "may") | - |
| 18 | `claim_1265` | `gm-o3-limited-adoption-2025` | not_adjudicable (Medium confidence) | published |
| 19 | `claim_0749` | `gm-no-hallucination-free-chatbots-by-2025` | supported | held: OpenAI says leading-model errors do not prove that no perfect chatbot existed; one contract fix did not change that |
| 20-23 | `claim_1759`, `claim_1254`, `claim_1255`, `claim_1258` | none | - | not drafted: time box |

Errata, round 2: `claim_0749`'s post is dated 2024-02-23, not 2024-02-24 as in the legacy row; corrected by a claim revision before review.
