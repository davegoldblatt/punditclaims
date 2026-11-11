# 0005 A second chance for held claims with a settled verdict

Date: 2026-10-29. Owner decision. Policy 2026-10-28.7 is unchanged.

On release 20261029T225230Z, the evidence had settled 188 of Ed Zitron's claims and 789 of Gary Marcus's. Some held claims already had a settled verdict and were held for a reason that more work can fix. The owner asked for them to be fixed ("getting up to 300 is huge"). He also asked for a hand fix. A hand fix is refused: a verdict is never edited by hand (AGENTS.md), and the site says that two AI reviewers from different companies checked each verdict.

Two groups get one more pass through the same gate:

1. **The wording failed, the verdict did not.** Both reviewers agreed on the verdict, but the final-text check failed or the draft said something else. Until now a packet got one rewrite (`scripts/revise.ts`). A packet now gets a second rewrite when the agreed verdict is supported, mixed, or contradicted. The verdict stays the reviewers'. The provider other than the drafter checks the new text. On this release, 158 of Marcus's claims and 46 of Zitron's qualify.
2. **A reviewer found the criteria unfair to the speaker's words.** The draft's verdict was settled, but a reviewer said the test did not match what was said. `scripts/grade.ts` now redrafts these claims once. The reviewers' notes go to the drafter as data, the redraft freezes a new contract version and a new evidence packet, and both providers review it again from the start (`scripts/review-batch.ts`). On this release, 141 of Marcus's claims and 50 of Zitron's qualify.

The rule is the same for both people, and code picks the claims. Only claims with a settled verdict get the second chance, because only a settled verdict counts toward the answer. "Fix once, then hold" still applies to everything else. A claim that is still held after its second chance stays held.

Grading uses ChatGPT, so it runs now. The final-text checks and the reviews need Claude.

**Amended 2026-10-30, after the cross-vendor review (gpt-6-astra, xhigh).** The review found that offering the second chance only to settled verdicts makes entry into the counted sample depend on a preliminary outcome: an unfair test that first produced "unresolved" got less repair than one that produced "contradicted". The second chance is now outcome-blind: every held claim in either failure class gets it, whatever its verdict. On the data of 2026-10-30 that is 462 rewrites and 592 regrades, waiting for the providers. Also from the review: an outage at the final check now puts the draft back, so no rewrite goes unrecorded, and a call that never got an answer no longer uses up one of a claim's tries.

Resolved 2026-10-31 (owner: "ok fix it"). docs/policy.md now records this decision in section 11, "Owner decisions recorded under .7", without a version bump. The decision changes no existing review, and a bump would unbind them all.

