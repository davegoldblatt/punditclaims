// Predictions vs. claims about the present or past: the split must add up to
// the same totals the answer uses, at every confidence level.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_OF, GROUPS, LEVELS, pcts, splitCounts } from "../src/lib/split.ts";
import { CLAIM_KINDS } from "../src/policy.ts";
import type { HeldRecord, PublicClaim } from "../src/lib/manifest.ts";

const claim = (kind: string, outcome: string, probable?: { call: string; level: string }) =>
  ({ kind, current: { payload: { outcome } }, ...(probable ? { probable } : {}) }) as unknown as PublicClaim;
const held = (kind: string | undefined, probable?: { call: string; level: string }) =>
  ({ kind, ...(probable ? { probable } : {}) }) as unknown as HeldRecord;

const live = [
  claim("forecast", "supported"), claim("forecast", "contradicted"), claim("conditional_forecast", "mixed"),
  claim("forecast", "unresolved"), claim("forecast", "unresolved", { call: "probably_right", level: "reasonable" }),
  claim("observation", "supported"), claim("causal", "contradicted"), claim("observation", "unresolved", { call: "probably_wrong", level: "speculative" }),
  claim("normative", "not_adjudicable"), claim("rhetoric", "not_adjudicable"),
];
const heldRecs = [
  held("forecast", { call: "probably_wrong", level: "reasonable" }),
  held("observation", { call: "probably_right", level: "speculative" }),
  held("observation"), held(undefined, { call: "probably_right", level: "reasonable" }),
];

test("every kind belongs to exactly one group or to neither", () => {
  for (const k of CLAIM_KINDS) assert.ok(k in GROUP_OF, k);
  assert.equal(GROUP_OF.forecast, "prediction");
  assert.equal(GROUP_OF.conditional_forecast, "prediction");
  assert.equal(GROUP_OF.observation, "present");
  assert.equal(GROUP_OF.causal, "present");
  assert.equal(GROUP_OF.normative, null);
  assert.equal(GROUP_OF.rhetoric, null);
});

test("strict counts only settled claims, and open counts the unresolved", () => {
  assert.deepEqual(splitCounts(live, heldRecs, "prediction", "strict"), { supported: 1, mixed: 1, contradicted: 1, open: 2, probable: 0 });
  assert.deepEqual(splitCounts(live, heldRecs, "present", "strict"), { supported: 1, mixed: 0, contradicted: 1, open: 1, probable: 0 });
});

test("reasonable adds reasonable calls; speculative adds both levels", () => {
  assert.deepEqual(splitCounts(live, heldRecs, "prediction", "reasonable"), { supported: 2, mixed: 1, contradicted: 2, open: 1, probable: 2 });
  assert.deepEqual(splitCounts(live, heldRecs, "present", "reasonable"), { supported: 1, mixed: 0, contradicted: 1, open: 1, probable: 0 });
  assert.deepEqual(splitCounts(live, heldRecs, "present", "speculative"), { supported: 2, mixed: 0, contradicted: 2, open: 0, probable: 2 });
});

test("the two groups add up to the all-claims settled totals at strict", () => {
  for (const level of LEVELS) {
    const sum = GROUPS.map((g) => splitCounts(live, heldRecs, g, level)).reduce((a, b) => ({ supported: a.supported + b.supported, mixed: a.mixed + b.mixed, contradicted: a.contradicted + b.contradicted, open: 0, probable: 0 }));
    if (level === "strict") assert.deepEqual([sum.supported, sum.mixed, sum.contradicted], [2, 1, 2]);
  }
});

test("percentages add to 100 and use the largest remainder", () => {
  assert.deepEqual(pcts({ supported: 76, mixed: 0, contradicted: 5 }), { supported: 94, mixed: 0, contradicted: 6 });
  assert.deepEqual(pcts({ supported: 1, mixed: 1, contradicted: 1 }), { supported: 34, mixed: 33, contradicted: 33 });
  assert.deepEqual(pcts({ supported: 0, mixed: 0, contradicted: 0 }), { supported: 0, mixed: 0, contradicted: 0 });
});
