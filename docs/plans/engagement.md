# Plan: more ways in, so people stay and come back

Status: proposal, 2026-10-29, for one cross-vendor review. Dave: "are there any other cuts or options you can use to make it as engaging as posible?? do research and cross vendor review".

## Where the site is

Live today: a home page with an answer per person; Explore (`/explore`) with filters for person, company, topic, kind, outcome, and year, an answer for the cut, a year chart and a company chart that filter on click, and rows led by the speaker's words. Release 20261029T214132Z: 5,834 published claims. 64 predictions are unresolved and not yet due. Recurring words in the quotations: Marcus says "AGI" in 219 and "hallucinat-" in 99; Zitron says "hype" in 108 and "bubble" in 79.

## What the research says

- **Predict before you see.** Asking people to predict data before showing it improved recall and comprehension, even for people who knew little about the topic (Kim, Reinecke, Hullman, CHI 2017 best paper, [UW IDL](https://idl.uw.edu/papers/explaining-the-gap)). The effect was weaker when the data was shown as text rather than as a graphic.
- **Curiosity is a small, closable gap.** It is strongest when a person knows a little and the answer is one step away. A violated expectation and being asked to guess both raise it (Loewenstein 1994, the information-gap theory, [summary](https://concepts.dsebastien.net/concept/information-gap-theory/)). Telling the answer first kills it.
- **Quizzes that return something personal travel.** The NYT dialect quiz, built from a dialect survey, was one of its most popular interactives ([Peabody](https://peabodyawards.com/nytimesdialectquiz/), [Language Log](https://languagelog.ldc.upenn.edu/nll/?p=9351)). I could not verify specific engagement numbers.
- From the first review: show denominators, keep hindsight in check by showing what was known when the call was made, and do not let engagement features turn into a highlight reel or a hit list.

## Proposed features, ranked by value for the cost

1. **Coming due.** Every unresolved prediction with a stated window that is still open, grouped by the month or year it comes due, with the speaker's words, the deadline as written, and the evidence we will look for (the frozen criteria). Gives a reason to return, and its own feed. 64 records today.
2. **Guess first.** An opt-in mode: show a settled claim's words and date, the reader picks "Came true", "Partly", or "Didn't", then sees the verdict and the evidence. Their running tally sits next to the pundit's. Claims come from a fixed, outcome-independent rule: all settled predictions, in a random order seeded per visit, the same pool for both people. The reveal states the criteria frozen before grading, which counters hindsight.
3. **Compare on the same subject.** When a cut contains both people, a side-by-side view: each person's answer, counts, and their three newest settled claims on that subject. "OpenAI: Marcus vs Zitron."
4. **How often they say it.** When a search term is set, the year chart becomes quarterly: how often their quotations use the term over time, split by outcome. "Bubble" over time is the obvious one.
5. **Small helpers.** Sort (newest, oldest, settled first), "Show me a random claim", a "Copy link to this cut" button, and per-person pages that use the same charts.

Not proposed: a word cloud, leaderboards, a single accuracy percentage across both people, or streak or badge mechanics.

## Questions for review

1. Is "Guess first" sound, or does it trivialise the evidence or invite a hit-list reading? What pool and order keep it fair to both people?
2. Is "Coming due" honest when many windows are vague ("in the next year", "soon")? What should qualify?
3. What is missing that would do more for engagement than these five?
4. What is the right order to build in, given one evening of work?
