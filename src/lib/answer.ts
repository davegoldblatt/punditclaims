// The plain answer to "were they right?" for one person, chosen by code from
// the counts of that person's settled claims (supported, mixed, or
// contradicted). A mixed outcome counts as half. Fewer than MIN_SETTLED
// settled claims is too early to call. The method page publishes the rule.
export const MIN_SETTLED = 10;
export const ANSWER_BANDS: { from: number; words: string }[] = [
  { from: 0.8, words: "Mostly right." },
  { from: 0.6, words: "More right than wrong." },
  { from: 0.4, words: "Right about as often as wrong." },
  { from: 0.2, words: "More wrong than right." },
  { from: 0, words: "Mostly wrong." },
];
export const TOO_EARLY = "Too early to say.";

export function answerFor(settled: { supported: number; mixed: number; contradicted: number }): string {
  const n = settled.supported + settled.mixed + settled.contradicted;
  if (n < MIN_SETTLED) return TOO_EARLY;
  const share = (settled.supported + settled.mixed / 2) / n;
  return ANSWER_BANDS.find((b) => share >= b.from)!.words;
}
