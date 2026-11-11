# Editorial policy

Policy version `2026-10-28.7`, effective 2026-10-28. Versions `.1` to `.6` were replaced the same day, before any record was public: `.1` after a cross-vendor audit found gaps in the rules, `.2` to `.4` after pilot reviews showed the rules did not say clearly enough which confidence language is scored, `.5` by the owner's decision to quote every claim in full, `.6` by the owner's decision to score firm claims that name no measure on a plain reading, and `.7` to screen every claim in the corpus before grading. The machine-readable copy is `policy/policy.yaml`. The code that enforces it is `src/policy.ts` and `src/lib/rules.ts`. If this page and the code disagree, the code is a bug and this page wins until the code is fixed.

Owner decisions made after `.7` are recorded in section 11 without a new version number. None of them changes the inputs, the gate, or the verdict of any existing review, and a version bump would unbind every review in the corpus. Section 11 says what each one changed. The next version folds them in.

## 1. What this register is

A curated, public record of claims made by the people named in the deployment's configuration (`config/register.yaml`). This deployment covers AI claims by Gary Marcus and Ed Zitron. The rules below apply the same way to anyone. For each selected claim it shows what was said, what the statement commits the speaker to, what evidence arrived, what assessment that evidence justifies, and what changed afterwards.

It does not rank anyone, weight claims, or judge intent. Since the owner decision of 2026-10-29 (section 11), the home page gives each person an answer in words, chosen by code from the counts of settled claims. Counts describe the claims in the covered windows, and never the person's whole output. Leaving a statement out says nothing about whether it was right, wrong, or important.

Other people can appear as sources, as quoted third parties, or as the subject of a claim. They never become a third subject. Adding a subject is a policy change with a new version, not a data edit.

## 2. Sources and coverage

Statements come from the subjects' public long-form writing: Marcus on AI (garymarcus.substack.com) and Where's Your Ed At (wheresyoured.at). The windows, the retrieval cutoff, and the basis for each are in `policy/policy.yaml` under `source_windows`. The coverage page reports, for each window, how many posts were found, read in full, paywalled, and not loaded, and how many claims they held.

The legacy Marcus dataset (2,218 extracted claims, snapshot of 2026-03-02) is a research input, used only as a cross-check list for the Marcus windows. None of its scores, clusters, quotations, or counts is published because it appeared there. Every public record passes the rules on this page.

Paywalled posts are counted and not read. A paywall preview is never treated as the full text. A source observed today is shown with today's observation date; nothing claims that today's wording was captured years ago unless an archived copy from then exists.

## 3. Selection

Since `.7` the register covers every claim extracted from every readable post in the declared windows (section 6, the screen). Nothing is chosen because its outcome is known, and nothing is dropped because of its outcome. Each claim still records the stratum below that admitted it. In the full corpus, every claim is recorded as `declared lead`.

The pilot cohort before `.7` was selected by the stratum order and the stopping rule below. They no longer limit the register and are kept here as the record of how the pilot was chosen. The strata:

- matured dated forecast: an explicit date or relative horizon that has passed;
- open dated forecast: an explicit horizon that has not passed;
- central recurring proposition: repeated in three or more posts, counted once;
- evidence changed: named new primary evidence arrived inside the window;
- declared lead: named in the project's source inventory.

The eligible inventory for each subject is frozen, with its hash, before grading. A candidate belongs to the first stratum in the list above that it qualifies for. For each subject, candidates are taken stratum by stratum in that order and, within a stratum, in the order of the sha256 of the policy version plus the candidate id. For the pilot, taking stopped at 20 candidates per subject or when the inventory ran out. The selected ids and every disposition (published, held, or rejected with its reason) are published, so anyone can reproduce the cohort. A candidate is never chosen because its outcome is known to embarrass or flatter the author, and never dropped after grading because of its outcome.

## 4. Statements, claims, and assessments

A statement (an occurrence) is what someone said at a particular time in a particular source. A claim is the proposition that statement commits them to. An assessment is our judgment of the claim at a stated evidence cutoff. They are separate records.

Attribution: a subject's claim rests only on statements the subject endorsed. Quoting a critic, reporting what someone else said, or a reader's comment is not the subject's claim.

Atomic claims: a compound statement can produce several claims. A recommendation and the factual premise it rests on are split. Topics are navigation only and never carry a verdict. Topic suggestions match whole words, never substrings.

Repetition: the same proposition under the same conditions is one claim with several occurrences. Occurrences are shown; they do not multiply the count of distinct claims. In the full corpus (`.7`), repeats across posts are not linked yet, so each repetition is its own record for now (section 6). Linking them is planned and will not change any outcome. A materially changed commitment (deadline, population, metric, condition, quantifier, or target) is a new claim linked to the old one, and the old one keeps its own horizon. Revisions under one claim id are reserved for our own corrections of interpretation, attribution, or copy. A changed wording is recorded as a revision by the speaker, without any accusation of moving goalposts. An uncertain merge stays two flagged claims.

Claim kinds:

- `observation`: a statement about how things are or were.
- `forecast`: a statement about what will happen.
- `conditional_forecast`: a forecast that depends on an antecedent. The antecedent is kept.
- `causal`: a statement that one thing caused or causes another.
- `normative`: a recommendation or value judgment. A date inside a recommendation does not make it a forecast.
- `rhetoric`: an expression that commits to no testable proposition.

## 5. Resolution criteria

Before any outcome is graded, the claim's normalised proposition and its resolution contract are frozen. The contract separates what the speaker said (explicit source elements) from what we added to make it testable (our interpretation, labelled as ours). Only dates and thresholds the speaker stated are recorded as commitments. A missing deadline stays missing; a vague phrase is shown as written. When a firm claim names no measure (for example "the bubble will begin to burst within 12 months"), it is scored on the plain reading an informed reader would take: the reading is written down as our interpretation before grading, both reviews must find it fair, and the page says the record was scored on a plain reading. Hedged or probabilistic language is still not scored.

Criteria written after the outcome was public are labelled retrospective. A record is prospective only when it is a forecast whose contract froze before its deadline, while its outcome was not yet public, and every decisive piece of evidence became public after the freeze. An unexpired deadline alone does not make a record prospective. Later changes to a frozen contract create a new version and require a new review.

## 6. Axes, outcomes, and horizons

Each assessment answers one question, its axis:

- `historical_observation`: was it true for the period it describes? Evidence must be dated precisely enough to fall inside that period. Evidence about a later period is context, never support or contradiction.
- `forecast_outcome`: did the forecast come true under its original conditions and horizon?
- `causal_assessment`: does evidence suited to causation support the cause? Limits are stated.
- `not_applicable`: normative and rhetorical statements, and empirical claims too open to test. They are recorded, attributed, and not scored.

Outcomes:

- `supported`: the dated evidence matches what the claim committed to.
- `contradicted`: the dated evidence goes against what the claim committed to.
- `mixed`: part holds and part does not, and the record says which.
- `unresolved`: the record was checked, and the evidence available by the cutoff does not settle it. A search record and the gap are shown.
- `not_adjudicable`: a recommendation, value judgment, or claim too open to test.

The screen (policy .7). The register covers every claim in the declared windows. Before any grading, both providers read each post with the claims extracted from it and answer, for every claim: is it the author's own endorsed assertion, is the normalised proposition faithful to his words, is the kind right, and could public evidence settle it at all? A claim both providers find uncheckable is published as `not_adjudicable` with their reasons: `value_judgment`, `rhetoric`, `probability_language`, `no_plain_reading` (informed readers would test it in different ways and reach different answers), or `no_public_evidence` (a private intention, a counterfactual). Its page text is composed by code from the screen, so no model writes prose for it. Every other claim, including any where the two screens disagree, is graded on its own: dated evidence, two full reviews, and a final-text check. A firm claim with a plain reading is checkable; vagueness alone does not make a claim uncheckable unless readers would genuinely disagree about what would settle it. When both full reviews agree with each other but not with the draft, or the final-text check finds that the draft says more than the evidence, the drafter rewrites the public text to state exactly the reviewers' agreed assessment, and the other provider checks the new text. Under ADR 0005 (section 11) a packet can get a second rewrite, and a claim a reviewer found unfairly tested can get one regrade against a new contract. The verdict is always the two reviewers'. Each statement is recorded and graded as its own claim. When the author repeats a claim in several posts, each repetition is a separate record for now; linking repeats is planned and will not change any outcome.

Horizon states are separate from outcomes:

- `not_applicable`: the axis has no horizon.
- `open_horizon`: the speaker gave no deadline. None is inferred.
- `not_due`: the deadline has not passed. Absence of the event before the deadline is not failure.
- `elapsed`: the deadline has passed.
- `conclusive_event`: the forecast was settled before its deadline by an event its contract allows.

A deadline passing never sets an outcome. It queues a review. When that review completes, the review trigger clears, even if the outcome stays unresolved.

Conditional forecasts: a conditional is scored only when evidence shows its antecedent happened. If the antecedent did not happen, or nobody can tell, the conditional is neither confirmed nor falsified.

Hedged and probabilistic forecasts: a single outcome does not grade a probability or a possibility. Statements of probability or possibility ("may", "might", "could", "likely", "probably", "a good chance", "I suspect", "I would not be surprised") are recorded and not scored. Statements of unqualified expectation or high confidence about a definite outcome ("I expect", "I predict", "I am confident that", "I am more confident than ever that", "high confidence", "I bet", "will", "won't") are forecasts and are scored. A forecast its author files under graded medium or low confidence is treated like "likely" and is not scored. Committing to an outcome is scored; naming a chance or a middling confidence is not.

Only outcome evidence decides an outcome. The speaker's own statement proves what was said, never that it was true.

Early resolution: a forecast settled before its deadline names the evidence item that is the event, its date, and how it meets the early-resolution rule in its contract.

Financial claims: the metric, currency, units, accounting basis, fiscal or calendar period, stock or flow, annualised or realised, and gross or net are recorded. Evidence counts only when it measures exactly the same quantity over exactly the same period, or derives it with stated inputs, formula, and rounding. A claim with no stated accounting basis is not scored. Revenue is not annualised run rate. Financing is not revenue. Operating income is not net income. A cash balance is not cash flow. Multi-year commitments are not all payable now. A better 2026 quarter does not falsify an accurate statement about 2025. Audited and unaudited figures, and reported figures and estimates, are labelled. Derived arithmetic shows its inputs, formula, and rounding.

Hindsight: an evidence packet uses only what was public by its cutoff.

## 7. Review and publication

The project mirrors Because of AI's automated method. One model drafts the record. Two models from different providers (Anthropic and OpenAI) review the same frozen claim, contract, and primary-source evidence independently, without seeing each other's reasoning or a requested answer. A model from a provider other than the drafter's then checks the final reader-visible text against the frozen inputs. Reviewing models run with no tools: no shell, no files, no network. Reviews run through the providers' own subscription clients (the Claude and Codex command-line logins) with every tool switched off, which a probe with a planted canary checks before each run. The API route remains for runs under a spend ceiling (`docs/operations.md`). Each review record names its route. Code, not a model, decides whether a record publishes. Model agreement is a check on the record, not evidence that the claim is true, and it is never described as human fact-checking. The models grading these claims are made by companies that some of the claims are about. That conflict is stated here and on every claim page, and stated specifically beside any claim about Anthropic or OpenAI. Company statements about themselves are labelled as company disclosures, not independent findings. Financial arithmetic is shown so a reader can redo it.

A record publishes only when every check passes. Otherwise it is held with one of these reasons, and the held list is public:

- `source_unavailable`: the source could not be read.
- `source_partial`: only part of the source could be read.
- `attribution_uncertain`: we cannot be sure the subject said and endorsed it.
- `quote_mismatch`: the quotation did not match the source.
- `criteria_ambiguous`: the contract cannot be made fair to the speaker's words.
- `evidence_incomplete`: the evidence needed was not available.
- `semantic_disagreement`: the two reviews read the claim differently.
- `assessment_disagreement`: the two reviews reached different assessments.
- `verification_unavailable`: a required check could not run, including a provider outage or missing credentials.
- `malformed_review`: a review returned an unusable answer.
- `stale_binding`: the text changed after it was checked.
- `budget_exhausted`: the run stopped at its budget.
- `disputed`: a dispute is open.
- `policy_mismatch`: the record does not meet the current rules.

Held is a publication state, not a finding. A provider outage never becomes an unresolved verdict. A well-checked case with genuinely insufficient evidence can publish as unresolved. An unchecked case cannot publish at all.

There are no grandfathered records. Every public assessment passed the gate under the policy version it names.

Quoting: every claim shows the speaker's own words in full, up to 80 words per quotation, with a link to the original. There is no per-source cap in this policy version; the words are quoted for commentary and criticism and remain the author's.

## 8. Corrections, disputes, and history

Every change is an event with a date and a reason. Speaker events (`speaker_clarified`, `speaker_revised`, `speaker_retracted`) and site events (`site_corrected`, `assessment_changed`, `assessment_withdrawn`, `under_review_flagged`) never share a label. A formatting edit is not an event.

Readers dispute a record through a GitHub issue. A dispute enters a queue. It cannot change the site, run code, or reach credentials. Dispositions are upheld, rejected, or under review, each with a reason. A raw dispute is never shown as a finding.

Privacy, rights, or safety problems with quoted text go to a private contact route, not a public issue. The editor can remove the affected text from every current and historical page with a dated, logged notice and no new verdict. Copies already distributed cannot be recalled.

A verified problem with a published assessment (a quotation that does not match, a failed attribution, a source-integrity failure, an extraction error, or verified material counterevidence) can flag the assessment as under review or, for an integrity failure, withdraw it, through a narrow release that carries no new verdict. Restoring a withdrawn assessment requires a new assessment through the full gate. Old versions stay readable at their own addresses with a clear notice.

## 9. When this policy changes

A change to the vocabulary, the axes, or any rule bumps the version. Existing assessments keep the policy version they passed and are never described as passing a newer one. When a change could alter an existing outcome, that assessment is flagged for review. Reaffirming it runs the full gate under the new version.

## 10. Examples (synthetic)

These examples are invented to show the rules. They are not statements by either subject.

- "If the next model disappoints, valuations may suffer." Kind `conditional_forecast`. The antecedent ("the next model disappoints") is kept. If the model did not disappoint, the record is `not_adjudicable` on that antecedent, never `contradicted`.
- "Labs should publish safety audits by December." Kind `normative`. Recorded and attributed. Axis `not_applicable`, outcome `not_adjudicable`.
- "Work on the model is paused," written in September. Kind `observation`, judged on September. A release two years later is context.
- "The company's 2025 expenses exceeded its revenue." Judged on 2025 figures with the same basis. A better 2026 quarter is context.
- "No system will do X by the end of 2027," read in 2026. Horizon `not_due`, outcome `unresolved`. It is recorded now, so when the deadline passes the record is prospective.

## 11. Owner decisions recorded under `.7`

Each of these was decided by the owner after `.7` took effect. None changes the inputs, the gate, or the verdict of any existing review, so the version stays `.7` and no review is unbound. The next policy version folds them in.

- **2026-10-29: an answer in words.** The home page answers "were they right?" for each person. Code picks the words from the counts of settled claims: supported, mixed (as half), and contradicted (`src/lib/answer.ts`; the bands are on the method page). Under 10 settled claims, the answer is "Too early to say." This replaces the `.1` sentence "there is no accuracy percentage". Unresolved, uncheckable, and held claims are left out of the answer and never count as wrong.
- **2026-10-29, amended 2026-10-30: a second chance for held claims (ADR 0005).** A packet whose reviewers agreed but whose wording failed can get a second rewrite. A claim a reviewer found unfairly tested can get one regrade against a new contract, reviewed again from the start by both providers. The second chance is outcome-blind. The verdict is always the reviewers'. A hand fix is never allowed.
- **2026-10-29: probable calls (ADR 0006).** Both providers answer a looser question about unresolved and some held claims: would a reasonable, informed reader call this today? The same call from both is reasonable, and a call from one with "too early" from the other is speculative. A probable call never changes an assessment. It counts in the answer only at the confidence level the reader picks. The default, strict, counts settled claims only. Each agreeing provider's one-line reason is shown with the call.
- **2026-10-31: what the home page shows by default.** The answer pictures show only settled claims by default. Unresolved and uncheckable claims are switches that start off, on the home page, the person pages, and Explore.

