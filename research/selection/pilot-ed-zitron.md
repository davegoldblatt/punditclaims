# Pilot selection: Ed Zitron

Frozen 2026-10-28 (UTC 22:40), before any outcome evidence was looked up. Policy version `2026-10-28.2`.

This is a feasibility pilot, not the formal cohort. The formal inventory (`research/selection/ed-zitron.json` with its hash) does not exist yet.

## How the list was built

- Source pool: the free, full-text Where's Your Ed At posts already captured by discovery (145 of about 196 posts had a `full_public` version when this list was made). Premium previews were not used. `research/coverage/zitron-wyea.json` did not exist yet, so the pool came from `data/sources/wyea-*`.
- Search: sentence scan of the free posts for forecast wording (I predict, I expect, I believe ... will, I'm making the call, won't, by the end of 20xx, within, next few months, quarters), then the five declared leads from the delivery plan (doc-2, section 5) were read for firm commitments.
- Strata: each candidate gets the first stratum in policy order that it qualifies for. The drafting order follows the lead's pilot instruction (matured dated forecasts, then evidence-changed, then open dated forecasts, then declared leads). Within a stratum the order is sha256(policy version + candidate id), as `policy.yaml` requires.
- No candidate qualified as central-recurring. The closest, "OpenAI will die", is stated unconditionally in only one free post (The OpenAI Bubble, 2026-07-15). Two other posts state it with a condition ("without continual funding"), which is a different claim.
- Outcomes known to me from general knowledge before freezing (for example, that OpenAI raised money in 2025) did not decide inclusion. A candidate that cannot be completed stays on this list with its reason.

## Candidates

### Matured dated forecasts

1. `ez-ai-native-price-increases-few-months`
   - Post: https://www.wheresyoured.at/costs/ (2025-10-20, "This Is How Much Anthropic and Cursor Spend On Amazon Web Services")
   - Words: "I believe that we’re going to see multiple price increases on AI-native companies in the next few months."
   - Why: firm "I believe ... we're going to see" with a relative horizon that elapsed.
   - Deadline as stated: "the next few months" from 2025-10-20. No end date given.

2. `ez-openai-next-round-by-july-2025`
   - Post: https://www.wheresyoured.at/oai-business/ (2024-10-02, "OpenAI Is A Bad Business")
   - Words: "I believe that OpenAI, once it has raised its current ($6.5 billion to $7 billion) round, will have to raise another round of at least the same size by July 2025, if not sooner."
   - Why: firm dated forecast with a size threshold. Deadline passed.
   - Deadline as stated: "by July 2025".

3. `ez-ai-three-quarters-to-prove-itself`
   - Post: https://www.wheresyoured.at/peakai/ (2024-03-18, "Have We Reached Peak AI?"). Also a declared lead. Restated in https://www.wheresyoured.at/burst-damage/ (2024-08-05, also a declared lead).
   - Words: "I believe that artificial intelligence has three quarters to prove itself before the apocalypse comes, and when it does, it will be that much worse, savaging the revenues of the biggest companies in tech."
   - Why: relative horizon ("three quarters") that elapsed.
   - Deadline as stated: "three quarters" from 2024-03-18.

4. `ez-openai-convert-by-end-2025-or-dead`
   - Post: https://www.wheresyoured.at/the-haters-gui/ (2025-07-21, "The Hater's Guide To The AI Bubble")
   - Words: "the most important company in the entire AI industry needs to convert by the end of the year or it's effectively dead"
   - Why: conditional forecast with a dated antecedent (conversion by end of 2025). Deadline passed.
   - Deadline as stated: "by the end of the year" (2025).

5. `ez-wall-street-punishes-big-tech-by-q1-2025`
   - Post: https://www.wheresyoured.at/subprimeai/ (2024-09-16, "The Subprime AI Crisis")
   - Words: "Whether or not it's Q3 or Q4 2024, or even Q1 2025, Wall Street will begin punishing big tech for the sin of lust, and said punishment will savage these companies far more harshly than NVIDIA"
   - Why: firm "will" with a stated latest quarter. Deadline passed.
   - Deadline as stated: "Q3 or Q4 2024, or even Q1 2025".

### Evidence changed (Anthropic's S-1, filed 2026-10-26)

All three come from one paragraph of https://www.wheresyoured.at/dead-money/ (2026-09-29, "Dead Money", a declared lead), which relays figures from a Reuters report on a leaked S-1. They are split because each names a different metric.

6. `ez-anthropic-2025-lost-over-8bn`
   - Words: "In 2025, Anthropic lost over $8 billion on $4.6 billion in revenue."
   - Why: financial observation about calendar 2025. The S-1 is new primary evidence.
   - Period as stated: "In 2025". The metric for "lost" is not stated, and the next sentences separate it from net loss.

7. `ez-anthropic-2025-net-loss-42bn`
   - Words: "It technically had a net loss of $42 billion, but that was stock-related and was not a cash loss."
   - Why: financial observation with a named metric (net loss) for 2025.
   - Period as stated: 2025 (from the preceding sentence).

8. `ez-anthropic-2025-revenue-4-6bn`
   - Words: "In 2025, Anthropic lost over $8 billion on $4.6 billion in revenue."
   - Why: financial observation about calendar 2025 revenue.
   - Period as stated: "In 2025".

### Open dated forecasts

9. `ez-openai-broadcom-asic-not-in-2026`
   - Post: https://www.wheresyoured.at/the-haters-gui/ (2025-07-21)
   - Words: "Say OpenAI and Broadcom actually build their ASIC in 2026 (they won't)"
   - Why: firm negative forecast with a calendar-year horizon that has not passed.
   - Deadline as stated: 2026.

10. `ez-big-tech-2tn-ai-capex-by-2027`
    - Post: https://www.wheresyoured.at/am-i-meant-to-be-impressed/ (2026-05-06, "Am I Meant To Be Impressed?")
    - Words: "By the end of 2027, big tech will have sunk $2 trillion into AI capex, with very little to show for it."
    - Why: firm dated forecast with a threshold. Not due.
    - Deadline as stated: "By the end of 2027".

### Declared leads

11. `ez-oracle-collapses-without-openai`
    - Post: https://www.wheresyoured.at/what-happens-if-openai-dies/ (2026-08-18, declared lead)
    - Words: "Oracle will collapse without OpenAI’s revenue."
    - Why: the declared lead's firm conditional. No horizon.
    - Deadline as stated: none.

12. `ez-big-tech-capex-pressure-albatross`
    - Post: https://www.wheresyoured.at/burst-damage/ (2024-08-05, declared lead)
    - Words: "If generative AI becomes an albatross around the necks of Google, or Microsoft, or Amazon — which I believe it will — these companies will face serious pressure to curtail their investments and their capex spending."
    - Why: the declared lead's firm forecast, with an embedded conditional. No horizon.
    - Deadline as stated: none.

## Declared leads not turned into candidates

- https://www.wheresyoured.at/credit-crunch/ (2026-10-06): scenario analysis. No firm, testable commitment found in the free text.
- https://www.wheresyoured.at/exit-liquidity/ (2026-10-28): the firmest statement is that Anthropic "is intentionally misleading investors", which is a claim about intent. The register does not judge intent.

## Dispositions

Recorded 2026-10-28 after drafting. "Clean" means `scripts/ingest.ts` printed no PROBLEM and no RULE line. No record has been reviewed. The proposed outcome is the drafter's proposal only.

| # | Claim id | Disposition | Proposed outcome | Horizon | Contract policy |
|---|---|---|---|---|---|
| 1 | `ez-ai-native-price-increases-few-months` | clean draft | not_adjudicable (no end date, no actor, no definition of a price increase) | open_horizon | 2026-10-28.2 |
| 2 | `ez-openai-next-round-by-july-2025` | clean draft | supported | elapsed | 2026-10-28.2 |
| 3 | `ez-ai-three-quarters-to-prove-itself` | clean draft | contradicted (revenue element only) | elapsed | 2026-10-28.2 |
| 4 | `ez-openai-convert-by-end-2025-or-dead` | clean draft | not_adjudicable (antecedent not met) | elapsed | 2026-10-28.2 |
| 5 | `ez-wall-street-punishes-big-tech-by-q1-2025` | clean draft | not_adjudicable (measure and window are ours) | elapsed | 2026-10-28.2 |
| 6 | `ez-anthropic-2025-lost-over-8bn` | clean draft | not_adjudicable (no stated metric or basis) | not_applicable | 2026-10-28.3 |
| 7 | `ez-anthropic-2025-net-loss-42bn` | clean draft | supported | not_applicable | 2026-10-28.3 |
| 8 | `ez-anthropic-2025-revenue-4-6bn` | clean draft | supported | not_applicable | 2026-10-28.3 |
| 9 | `ez-openai-broadcom-asic-not-in-2026` | not drafted | stopped at the pilot time box | | |
| 10 | `ez-big-tech-2tn-ai-capex-by-2027` | not drafted | stopped at the pilot time box | | |
| 11 | `ez-oracle-collapses-without-openai` | not drafted | stopped at the pilot time box | | |
| 12 | `ez-big-tech-capex-pressure-albatross` | not drafted | stopped at the pilot time box | | |

Notes:

- The policy moved from `2026-10-28.2` to `2026-10-28.3` during drafting. Contracts 1 to 5 froze under `.2`. The change defines which confidence language is scored. Under `.3`, "I believe ... will" is confidence about a definite outcome and is scored, which is how candidates 2 and 3 were drafted. The within-stratum order above was computed with `.2`. Under `.3` the sha256 order would differ.
- Candidates 7 and 8 take the accounting basis from the source Zitron names (Anthropic's S-1, which reports under U.S. GAAP). Each contract flags this. If the gate reads that as no stated basis, both become not scored.
- Candidate 3 names several companies, so its contract has no single metric scope. Each evidence item carries its own.

## Round 2 extension (frozen 2026-10-28, 23:15 UTC, policy `2026-10-28.4`)

Appended before any outcome evidence for these eight candidates was looked up.

How the list was built:

- Pool: the 180 free, full-text posts in `research/coverage/zitron-wyea.json`. Premium previews were skipped.
- Search: a sentence scan of those posts for dated forecast wording ("I predict", "I'm making the call", "I believe ... will", "by the end of 202x", "by <month> 202x", "within / in the next <period>"). Each hit was read in context. A hit was kept when it is about AI, in Zitron's own voice (not relayed reporting in the same sentence), and states a firm outcome with a date or relative horizon. Non-AI forecasts (for example about Twitter) are outside this register.
- Strata and order: policy order (matured dated forecasts, then open dated forecasts). Within a stratum, sha256 of `2026-10-28.4` plus the candidate id. Taking stops at 20 candidates in total for this subject, so the evidence-changed stratum gets no new candidates in this round.
- What I already knew: while fixing round-1 records I read Anthropic's S-1 statement of operations and cash-flow summary (2023 to the first half of 2026). That bears on Anthropic financial statements, none of which is added here. From general knowledge I know OpenAI raised money in March 2025 and, per Zitron's own later posts, in March 2026. That did not decide inclusion.

### Matured dated forecasts

13. `ez-big-tech-560bn-ai-capex-2024-2025-if-promises-kept`
    - Post: https://www.wheresyoured.at/the-haters-gui/ (2025-07-21)
    - Words: "If they keep their promises, by the end of 2025, Meta, Amazon, Microsoft, Google and Tesla will have spent over $560 billion in capital expenditures on AI in the last two years, all to make around $35 billion."
    - Deadline as stated: "by the end of 2025". Conditional on "if they keep their promises".
14. `ez-openai-needs-more-money-within-year-2025-03`
    - Post: https://www.wheresyoured.at/power-cut/ (2025-03-03)
    - Words: "with the cast-iron guarantee that it will need more money within a year."
    - Deadline as stated: "within a year" of 2025-03-03.
15. `ez-openai-needs-40bn-more-within-year-2025`
    - Post: https://www.wheresyoured.at/openai-is-a-systemic-risk-to-the-tech-industry-2/ (2025-04-14)
    - Words: "OpenAI will need at least another $40 billion in the next year."
    - Deadline as stated: "in the next year" from 2025-04-14. Related to 14 (a stated amount).
16. `ez-microsoft-200bn-capex-by-end-2025`
    - Post: https://www.wheresyoured.at/wheres-the-money/ (2025-02-24)
    - Words: "I must repeat that Microsoft will have spent over $200 billion in capital expenditures by the end of 2025."
    - Deadline as stated: "by the end of 2025". No start date in the sentence.

### Open dated forecasts

17. `ez-openai-another-round-by-march-2027`
    - Post: https://www.wheresyoured.at/what-happens-if-openai-dies/ (2026-08-18)
    - Words: "OpenAI will almost-certainly have to raise another round of funding by March 2027, likely at a similar scale to its $122 billion round from March of this year."
    - Deadline as stated: "by March 2027". The size clause is hedged ("likely").
18. `ez-anthropic-raise-200bn-within-year-2026`
    - Post: https://www.wheresyoured.at/ai-is-slowing-down/ (2026-06-08)
    - Words: "it will have to raise at least another $200 billion in the next year."
    - Deadline as stated: "in the next year" from 2026-06-08.
19. `ez-ai-services-majority-token-billing-by-end-2026`
    - Post: https://www.wheresyoured.at/four-horsemen-of-the-aipocalypse/ (2026-04-21)
    - Words: "I’m making the call that by the end of 2026, a majority of AI services will move some or all of their customers to token-based billing"
    - Deadline as stated: "by the end of 2026".
20. `ez-hyperscalers-1-3tn-genai-by-end-2026`
    - Post: https://www.wheresyoured.at/the-more-you-buy-the-more-you-lose/ (2026-07-28)
    - Words: "Hyperscalers will have sunk over $1.3 trillion dollars into generative AI by the end of 2026"
    - Deadline as stated: "by the end of 2026".

Drafting order for round 2: round-1 candidates 9 to 12 first, then 13 to 20 in the order above.

## Round 2 dispositions

Recorded 2026-10-28 (about 23:30 UTC). Gate results from `scripts/release.ts --dry-run`. "Published" means the gate would publish it. Nothing was released.

| # | Claim id | Change in round 2 | Gate result |
|---|---|---|---|
| 1 | `ez-ai-native-price-increases-few-months` | Proposal changed to unresolved (both round-1 reviews said so) | held: final-text check flagged my new rationale sentence. Wording fixed in the draft, not re-reviewed (one extra round per held record) |
| 2 | `ez-openai-next-round-by-july-2025` | Claim revision 2: keeps "have to" and the antecedent; antecedent and stated-need evidence added | held: OpenAI reviewer reads "have to" as a quantified need the evidence cannot show (unresolved); Anthropic reviewer says supported |
| 3 | `ez-ai-three-quarters-to-prove-itself` | August 2024 timing qualification shown in excerpt, criteria and limitations | published (contradicted) |
| 5 | `ez-wall-street-punishes-big-tech-by-q1-2025` | none | held (unchanged) |
| 6 | `ez-anthropic-2025-lost-over-8bn` | none: under a cash reading the S-1 gives $2.6 billion, under operating loss $8.06 billion, so the reading decides | held (unchanged) |
| 9 | `ez-openai-broadcom-asic-not-in-2026` | drafted; one wording fix | published (unresolved, not due) |
| 10 | `ez-big-tech-2tn-ai-capex-by-2027` | drafted; one fix | held: OpenAI reviewer finds the 2026-27 window an evaluator choice |
| 11 | `ez-oracle-collapses-without-openai` | drafted | published (unresolved, open horizon) |
| 12 | `ez-big-tech-capex-pressure-albatross` | drafted; rerun once with no change | held: both reviews say not adjudicable, but the OpenAI review twice gave horizon open_horizon on the not_applicable axis, so the final-text check never runs |
| 13 | `ez-big-tech-560bn-ai-capex-2024-2025-if-promises-kept` | drafted | held: reviewers split on whether total capex can stand for "capex on AI" |
| 14 | `ez-openai-needs-more-money-within-year-2025-03` | not drafted | stopped at the time box |
| 15 | `ez-openai-needs-40bn-more-within-year-2025` | not drafted | stopped at the time box |
| 16 | `ez-microsoft-200bn-capex-by-end-2025` | drafted; claim revision 2 adds "since 2023" from the same post | published (unresolved, elapsed) |
| 17 | `ez-openai-another-round-by-march-2027` | drafted; one fix | held: final-text check flagged "what would resolve" (it implied no round would settle a need forecast). Not re-reviewed |
| 18 | `ez-anthropic-raise-200bn-within-year-2026` | drafted | published (unresolved, not due) |
| 19 | `ez-ai-services-majority-token-billing-by-end-2026` | drafted | held: reviewers split between unresolved and not adjudicable ("AI services" undefined) |
| 20 | `ez-hyperscalers-1-3tn-genai-by-end-2026` | drafted; claim revision 2 takes companies and start date from the same post | published (unresolved, not due) |

Records 7, 8 and 4 were published in round 1 and not changed.
