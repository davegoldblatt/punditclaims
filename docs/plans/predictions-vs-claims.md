# Plan: predictions vs. claims about the present or past

Date: 2026-10-31. Owner request: "maybe we add another way to cut it: claims vs. predictions? i think humans think theyre the same". Then: "yeah do a plan then cross vendor audit and then build it".

## Problem

Readers hear "were they right?" as "did their predictions come true?" The answer on the home page counts every settled claim, and most settled claims are not predictions. On release 20261101T003804Z (strict level):

| Person | Group | Settled | Supported | Mixed | Contradicted | Share right (supported / settled) | Unresolved | Can't be checked |
|---|---|---|---|---|---|---|---|---|
| Gary Marcus | predictions | 81 | 76 | 0 | 5 | 94% | 296 | 687 |
| Gary Marcus | present or past (observation 702, causal 51) | 753 | 660 | 44 | 49 | 88% | 801 | 767 |
| Ed Zitron | predictions | 29 | 14 | 1 | 14 | 48% | 438 | 364 |
| Ed Zitron | present or past (observation 184, causal 33) | 217 | 103 | 26 | 88 | 47% | 749 | 626 |

Recommendations, value judgments, and rhetoric are never settled (all can't be checked). They belong to neither group's answer.

A reader who sees "Mostly right" for Gary infers "his predictions came true". That is true here, but it rests on 81 predictions, not 834 claims. For Ed, the answer mostly reflects what he said about companies' finances at the time, not forecasts.

## Definitions

- **Prediction**: kind `forecast` or `conditional_forecast`. These are the same kinds as the existing Explore "Prediction" group and the "Predictions" saved cut.
- **Claim about the present or past**: kind `observation` or `causal`. A causal claim says what caused something that already happened or is happening.
- Recommendations, value judgments, and rhetoric fall in neither group. They are can't-be-checked by kind. They stay visible when "All" is chosen and in the lists.

Why the evidence dates differ: a prediction can only be settled by evidence about what happened after it was made. Policy forbids anything else (none of the 104 settled predictions relies on earlier evidence). A claim about the present or past is settled by evidence about that time, which often predates the statement. The plan does not change any verdict or rule.

## What changes

1. **Home and person pages: two lines under each answer.** They sit under the square grid and the three percentages:
   - "Predictions: mostly right. mostly right. 94% supported across 81 with a clear outcome. 0 mixed, 5 contradicted." The open count shows only with the Unresolved switch on (review finding 5).
   - "Claims about the present or past: mostly right. 88% right across 753 with a clear outcome. 44 mixed, 49 wrong."
   - The words come from the same answer rule (`answerFor`, mixed counts as half, under 10 settled gives "Too early to say."). The percentage is supported / settled, the same figure the big stats and Explore use.
   - Each line exists per confidence level, like the stats (`lvl-strict`, `lvl-reasonable`, `lvl-speculative`). At reasonable and speculative it counts probable calls in that group. Held records need their claim kind for this. See item 4.
   - Every number carries a `data-count` key that check-dist verifies (item 5).

2. **Explore and person pages: a visible "What kind" switch.** It sits next to the sort, with three options: All, Predictions, Present and past. It is a shortcut onto the existing kind filter:
   - Predictions sets kind = prediction.
   - Present and past sets kind = observation and causal.
   - All clears the kind filter.
   - It reads and writes the same `kind` URL parameter, so old links keep working. When the folded Kind select holds any other combination, the switch shows no option selected.
   - The answer for the cut, the charts, and the rows already follow the kind filter.

3. **Wording.** Use "Predictions" and "Claims about the present or past" in full sentences. Use "Present and past" on the switch. Do not use "observation" or "causal" in reader copy (they stay in the Kind dropdown as kinds).

4. **Release: held records carry their claim kind.** `HeldRecord.kind` is optional and set from the claim. Probable calls on held claims can then be split by group. The Explore index stops writing `kind: ""` for held entries. This is a release-shape change, so it needs a new release, with no change to any verdict, review, or binding.

5. **check-dist.** Add keys `split.<subject>.<group>.<level>.<supported|mixed|contradicted|open>`. For `strict`, they are recomputed from live claims. For `reasonable` and `speculative`, they also count probable calls at or below that level, from live claims and held records. The check fails on any mismatch, like the existing keys.

6. **Method page.** One short paragraph under "How the answer on the home page works": the answer covers both groups, the two lines split them, and why predictions use later evidence while present-or-past claims use evidence from their own time.

## Not changing

- The headline answer words still come from all settled claims. Recomputing the headline from predictions alone would hide most of the record. The split sits directly under it instead.
- No verdict, rule, prompt, or review changes. The policy version stays `.7`.

## Risks

- **Small samples.** Ed has 29 settled predictions. The answer rule's 10-claim floor applies per group. Under 10, the line says "Too early to say" with the count.
- **Misreading "present or past".** A claim like "Anthropic lost $8B in 2025", written in 2026, is about the past. "There were no new techniques" is about the present at the time of writing. The label covers both.
- **Page weight.** The lines add about 6 short paragraphs per person (2 groups × 3 levels). This is negligible.
- **Kind misclassification.** Kinds come from extraction and are confirmed by both screens (kind_correct). A misfiled forecast moves between groups, but no verdict changes.

## Tests

- Unit: a helper that splits a person's live claims and held records into the two groups per level. It must agree with the existing totals: group sums plus other kinds equal the all-claims counts.
- Build: check-dist verifies every split number.
- Manual: home, both person pages, and Explore with each switch option, on the local preview and then on the live URL (CSP).

## Cross-vendor review (2026-10-31, gpt-6-astra xhigh, one pass): SHIP WITH CHANGES

All seven findings were accepted and built in:

1. Blocker. "81 that came due" was wrong: 53 of the 81 name no deadline. The lines now say "with a clear outcome". At reasonable and speculative they name the probable calls they include, including under the 10-claim floor.
2. The evidence-date explanation was too broad: a conditional forecast can use earlier evidence to show its condition happened. The method page says so. The 104 figure covered forecasts only; with conditional forecasts there are 110 settled predictions.
3. check-dist now verifies every split number. That covers the total, the rounded percentage, mixed, contradicted, probable, and open. It also checks every Explore index entry's kind, for live and held entries.
4. Held probable calls in the current release had no kind. The release now writes `kind` on every held record, and check-dist fails if a held record with a probable call lacks it.
5. The "still open" count no longer shows by default. It sits in an inline span that only the Unresolved switch reveals. That span is nested inside the level-specific line, so no element carries both a level class and an outcome class.
6. Open is defined as live unresolved claims in the group without a probable call counted at that level. Held calls are counted once. It links to Explore with the person, the group's kinds, outcome=unresolved, and the level.
7. Percentages: the line says "supported" at strict, matching the big stats. It uses the same largest-remainder rounding as the big stats. The method page explains that the words count mixed as half and the percentages do not.
