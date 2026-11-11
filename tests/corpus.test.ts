// The full-corpus guards: every item ends in a complete disposition, routing
// is exhaustive with the policy's precedence, and merges never join different
// commitments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerProblems, mergeRefusal, routeClaim, type Commitment, type LedgerLine } from "../src/lib/corpus.ts";

test("every corpus item ends in a complete disposition", () => {
  const ok: LedgerLine[] = [
    { kind: "post", id: "p1", window: "w", url: "https://example.org/1", access_state: "full_public", status: "extracted", candidates: 2, note: null },
    { kind: "post", id: "p2", window: "w", url: "https://example.org/2", access_state: "full_public", status: "zero_claims", candidates: 0, note: null },
    { kind: "post", id: "p3", window: "w", url: "https://example.org/3", access_state: "public_preview", status: "inaccessible", candidates: 0, note: "paid subscribers only" },
    { kind: "candidate", id: "c1", post: "p1", quote_hash: "x", status: "claim", claim_id: "fx-a", merged_into: null, reason: null },
    { kind: "candidate", id: "c2", post: "p1", quote_hash: "y", status: "merged", claim_id: null, merged_into: "fx-a", reason: null },
    { kind: "legacy", id: "claim_0001", post: "p1", status: "matched", claim_id: "fx-a", reason: null },
  ];
  assert.deepEqual(ledgerProblems(ok), []);
  const bad = (patch: Partial<LedgerLine>, i: number) => ledgerProblems(ok.map((l, j) => (j === i ? ({ ...l, ...patch } as LedgerLine) : l)));
  assert.ok(bad({ status: "pending" }, 0).length, "a pending post");
  assert.ok(bad({ candidates: 3 }, 0).length, "a candidate count that does not match");
  assert.ok(bad({ note: null }, 2).length, "an inaccessible post without a note");
  assert.ok(bad({ status: "rejected", claim_id: null, reason: null }, 3).length, "a rejection without a reason");
  assert.ok(bad({ merged_into: null }, 4).length, "a merge without a target");
  assert.ok(bad({ status: "no_post", claim_id: null, reason: null }, 5).length, "a legacy row with no reason");
  assert.ok(ledgerProblems([...ok, ok[3]]).length, "a duplicate line");
});

test("routing is exhaustive and follows the policy's precedence", () => {
  const base = { kind: "forecast" as const, modality: "will", has_stated_horizon: true, has_target_period: false, graded_confidence: null };
  assert.equal(routeClaim(base).track, "evidence");
  assert.equal(routeClaim({ ...base, graded_confidence: "high" }).track, "evidence", "high confidence is scored");
  assert.equal(routeClaim({ ...base, graded_confidence: "medium" }).track, "no_evidence");
  assert.equal(routeClaim({ ...base, modality: "likely" }).track, "no_evidence");
  assert.equal(routeClaim({ ...base, kind: "normative", modality: "should" }).track, "no_evidence");
  assert.equal(routeClaim({ ...base, has_stated_horizon: false }).track, "evidence", "a firm open forecast can still be settled by a conclusive event");
  assert.equal(routeClaim({ ...base, kind: "observation", modality: "is" }).track, "hold", "an observation needs its period");
  assert.equal(routeClaim({ ...base, kind: "observation", modality: "is", has_target_period: true }).track, "evidence");
  assert.equal(routeClaim({ ...base, kind: "causal", modality: "is" }).track, "evidence");
});

test("merges never join different commitments", () => {
  const a: Commitment = { subject_id: "gary-marcus", kind: "forecast", polarity: "deny", modality: "will_not", predicate: "achieve AGI", target: "AI systems", target_version: null, threshold: null, metric: null, conditions: [], observation_period: null, horizon_end: "2025-12-31", graded_confidence: null };
  assert.equal(mergeRefusal(a, { ...a }), null);
  assert.equal(mergeRefusal(a, { ...a, predicate: "  Achieve  AGI " }), null, "spacing and case are not material");
  for (const [k, v] of [["horizon_end", "2027-12-31"], ["polarity", "affirm"], ["modality", "likely"], ["target_version", "GPT-5"], ["threshold", "8 of 10 tasks"], ["graded_confidence", "medium"], ["subject_id", "ed-zitron"]] as const) {
    assert.ok(mergeRefusal(a, { ...a, [k]: v }), `${k} must block a merge`);
  }
  assert.ok(mergeRefusal(a, { ...a, conditions: ["if scaling continues"] }), "added conditions block a merge");
});
