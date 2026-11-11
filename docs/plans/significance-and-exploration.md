# Plan: rank claims by what matters, and let readers cut the data

Status: reviewed 2026-10-29 (cross-vendor review: `significance-and-exploration-review.md`). The decision and corrections are in "After review" at the end. The body below is the proposal as reviewed. Asked for by Dave: "the whole thing of this is more of a data exploration, like cutting the data ... 'ais will attack companies at some point in 2026' is less relevant than ed zitron saying 'anthropic will go out of business by end of 2025'". Also: "it doesnt have to be specific to futurist predictions, like general data viz and human psychology on this stuff".

## The problem, measured

Release 20261029T170018Z (5,075 published claims, run still in progress):

- Gary Marcus reads "Mostly right": 600 settled claims, 88% supported. But only 56 of those 600 are predictions (52 supported, 4 contradicted). The rest are observations and causal claims, many of them easy ("Hallucinations are still here", "There is a growing wave of cyberattacks in Japan").
- Every claim counts the same. "The generative AI bubble will begin to burst by July 28, 2025" (contradicted) weighs the same as "Copyright lawsuits over generative AI will continue throughout the year" (supported).
- Hedged big calls ("the AI boom collapse could come soon") are "can't be checked" by policy, so the boldest-sounding statements often drop out of the answer entirely.
- Only 365 of 5,075 claims carry a deadline as written. Targets are free text: "openai" 430, "llms" 362, "anthropic" 107, "nvidia" 38, plus many near-duplicates ("openai and anthropic", "the ai industry").
- Topic tags (12) are too coarse to say anything. Every topic sat at 76 to 93% supported, so per-topic bars all looked the same (Dave: "these bars dont tell us anything").

## What the research says

Track records:
- **Easy calls inflate hit rates.** PunditTracker refused to publish raw hit rates because "the sun will rise tomorrow" scores perfectly. It rated each call's boldness when it was made, and paid out by the odds (a "yield"). It needed 25 graded calls before giving a grade. ([Ritholtz on PunditTracker](https://ritholtz.com/2013/02/pundit-tracker/), [AOL 2012](https://www.aol.com/news/2012-12-19-pundit-predictions-how-accurate-are-the-pros-bold-guesses.html))
- **Cherry-picked hits sell the next prediction.** Dan Luu found futurists quote a few lucky or vaguely similar hits. Kurzweil's 86% falls to about 7% when every prediction is graded. Vague predictions could not be scored at all. ([danluu.com](https://danluu.com/futurist-predictions/))
- **The confident get invited back.** Tetlock: confident hedgehogs forecast worst but are the most prominent, and there is no accountability. ([Expert Political Judgment](https://en.wikipedia.org/wiki/Expert_Political_Judgment))
- **What gets checked.** Fact-checkers pick claims that are newsworthy, likely to be repeated, and that "an ordinary person would wonder if it is true", plus potential harm and reach. ([Ballotpedia on methodologies](https://ballotpedia.org/The_methodologies_of_fact-checking), [Full Fact 2025](https://fullfact.org/blog/2025/apr/how-does-the-full-fact-team-choose-what-to-fact-check/), [multidimensional check-worthiness](https://arxiv.org/abs/2412.08185))

How people read this kind of page:
- **Vague statements feel accurate** (Barnum/Forer effect). A register that counts vague claims as "supported" rewards vagueness. ([Forer effect](https://en.wikipedia.org/wiki/Forer_effect))
- **Hindsight and outcome bias.** Once the outcome is known, people judge the call as more obvious, and judge the forecaster by the outcome rather than the reasoning. The fix is to show what was known when the call was made. ([Hindsight bias](https://en.wikipedia.org/wiki/Hindsight_bias), Baron & Hershey 1988)
- **Denominator neglect.** People fixate on the count of hits and ignore the total at risk. Showing the denominator, or icon arrays, corrects it. ([Garcia-Retamero, Galesic & Gigerenzer 2010](https://journals.sagepub.com/doi/10.1177/0272989X10369000), [AJPH 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2775772))
- **Overview first, zoom and filter, then details on demand** (Shneiderman 1996). Readers need the one-screen answer, then facets that cut the set, then the single record. ([The Eyes Have It](https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf))
- From standard practice (Cleveland and McGill, Tufte): compare on a common scale, sort by the value shown, use small multiples, and do not draw a chart where every bar looks the same. Write the finding as a sentence instead.

## Proposal

### 1. A significance rating for every checkable claim

Both providers rate each claim on a fixed rubric, in a screen-like batch per post (no web, medium effort):

- **Stakes:** what changes in the world if it is true. Examples: a company's survival, a market move, AGI timing, a law, a flagship product. Compare a generic persistence claim.
- **Specificity:** a named entity, a date or deadline, a number or threshold.
- **Boldness when said:** did it go against the visible consensus at the time? The rater says what the consensus was, not whether the call came true. It sees only the claim, its date, and the post, never the outcome.
- **Prominence in the source:** headline or thesis of the post, or an aside.

Each rater outputs a tier: **Headline call**, **Notable**, or **Routine**, with one sentence of reason. If they disagree, the claim takes the lower tier. Code adds two signals the models do not decide: how many posts repeat the claim (occurrences and related records), and whether a deadline is written.

The rating never changes an assessment. It is published with its rubric, and it is a reader aid, like a news value.

### 2. Theses: group claims into the arguments each person keeps making

Per person, one provider proposes 15 to 40 recurring theses from all of that person's claims (for example "The generative AI bubble will burst", "LLMs will not reach AGI", "OpenAI will run out of money", "Agents are not reliable"). The other provider checks the list. Then both assign each claim to at most one thesis. A claim gets a thesis only when both agree. Each thesis gets a page: every claim in it, the settled split, and a timeline of when each was said.

This replaces the 12 topic tags as the main cut. Dave's March dataset used 54 clusters the same way ("GenAI bubble will burst: 27% contradicted, his single worst cluster").

### 3. Normalised targets

Map the free-text targets to a short list of entities (OpenAI, Anthropic, Nvidia, Microsoft, Google, Meta, xAI, the AI industry, LLMs as a technology, AGI, regulation). Code does this with an alias table, and a model suggests aliases for the long tail. Each entity gets a page: "What they said about OpenAI".

### 4. The home page answers twice

- **On their big calls:** the answer, with the same rule as now, counted over Headline and Notable settled claims only. This is the number that matches what readers mean by "were they right".
- **On everything checkable:** the current answer, smaller, as context.
- Then **The big calls**: settled Headline predictions, hits and misses together, sorted by significance and then by date. Each shows their words, the date said, what was known then (from the boldness rating), and what happened.
- Then **Their theses, and how each is holding up**: one line per thesis, sorted by the number of settled claims. Each line has a sentence answer and its N.
- Then **Explore**: by company, by thesis, by year, by kind, predictions with deadlines.

### 5. An explore page with facets

One page, filters in the URL: person, thesis, entity, kind (prediction, observation, cause, opinion), outcome, significance tier, has deadline, year said. The counts for each facet value update with the other filters. The answer sentence updates with them too ("For OpenAI predictions by Ed Zitron: too early to say, 3 settled"). Static build: the facet data ships as a small JSON index, and the filtering runs in the browser. The site already does this for the register's filters.

## Cost and order

- Significance rating: about 680 post batches per provider on the subscriptions. It runs after the review backlog clears, because Claude's 5-hour limit is the bottleneck.
- Theses: about 4 calls per person to propose and check, then per-post assignment batches.
- Build order: targets (code only) → significance → theses → home and explore pages.

## Open questions for review

1. Is "lower tier wins" the right rule for disagreement, or does it bury real headline calls?
2. Can a model rate boldness at the time without hindsight leaking in, when the post date is recent and the model knows the outcome?
3. Is two answers on the home page clearer, or more confusing, than one?
4. Should hedged big calls ("could collapse soon") appear in "The big calls" as unscored context, given they are some of the most prominent things each person says?
5. Does "Headline call" itself overclaim, given it is a model judgment?


## After review (2026-10-29)

Corrections the review found, checked against the release:
- Topic support for Marcus runs from 64% (financing, 7 of 11) to 93%, not 76 to 93%.
- 365 is the count of claims with any horizon text, including "soon" and "ever". Only 325 are forecasts, and text does not make a deadline.
- "Hallucinations are still here, and aren't going away, anytime soon" is a supported forecast, not an observation.
- Repetition is not available yet: every published claim has one occurrence and no related records.
- The legacy dataset's cluster figures are quarantined and not reproduced in this release. Do not cite them.
- The register's browser filters work only on single-page groups (100 rows or fewer). There is no whole-corpus facet index yet.
- Dan Luu graded 4 of 59 (or 7 of 62) rated Kurzweil predictions, not every one. PunditTracker avoided retrospective boldness ratings. It did not refuse raw hit rates outright.

Decision:
1. **Ship first, no new model pass:** an Explore page over the whole release (search, person, company, topic, kind, outcome, year; URL-backed; counts per facet; paginated rows), and a reviewed alias table that maps free-text targets to companies and technologies, keeping the raw target and allowing several per claim. The home page links saved cuts (company finances, capabilities and reliability, safety and policy) and company pages. The answer stays one per person, with its completion counts. An outcome filter never re-labels the answer.
2. **Then, as separate attributes, not one score:** consequence scope (with anchored examples), commitments made (entity, date, number), and source prominence (with a locator). Both providers' ratings are kept and shown, disagreement is kept, "unknown" is allowed, and there is no "lower tier wins". No historical boldness rating without dated evidence of the consensus at the time. No "Headline call" label: "Selected claims" with the reason each was selected.
3. **Theses later, if at all:** a frozen codebook with stable ids and inclusion examples, several memberships allowed, "none" and "uncertain" allowed, and coverage and disagreement published.
4. **Any featured list** ("the big calls") gets an outcome-independent selection rule fixed before verdicts are read, the same rule for both people, one card per proposition, and a link to the full eligible set.
