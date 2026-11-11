// The two policy .7 gate paths, on the synthetic data tree: a claim both
// screens find uncheckable, and claims reviewed several to a call. Each failure
// case has the passing control above it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { makeTree, review, run } from "../fixtures/lib/tree.ts";
import { gate } from "../src/lib/gate.ts";
import { loadStore } from "../src/lib/data.ts";
import { claimRef, contractRef, packetRef, sealAssessment, sealContract, sealPacket } from "../src/lib/records.ts";
import { hashOf } from "../src/lib/canonical.ts";
import { caseDigest, claimDigest } from "../src/lib/binding.ts";
import { screenContractBody, screenPayload } from "../src/lib/screen.ts";
import type { Assessment, ScreenEntry } from "../src/schema.ts";

const T = "2026-10-28T12:00:00Z";
const PH = "c".repeat(64);
const write = (root: string, rel: string, body: unknown) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rel.endsWith(".json") ? JSON.stringify(body, null, 1) : YAML.stringify(body)); };
const entry = (id: string, over: Partial<ScreenEntry> = {}): ScreenEntry => ({ claim_id: id, speaker_is_subject: true, endorsed: true, proposition_faithful: true, kind_correct: true, proposed_kind: "forecast", checkable: false, reason: "no_plain_reading", test: null, timing: null, note: "ok", ...over });

type ScreenOver = { a?: Partial<ScreenEntry>; o?: Partial<ScreenEntry>; staleA?: boolean; onlyOne?: boolean; mixReview?: boolean; editPayload?: boolean; reasons?: [string, string]; tamperContract?: boolean };

// A screened-out claim: the screen contract, an empty packet, two screens, and
// the code-composed assessment.
function screened(over: ScreenOver = {}) {
  let assessment!: Assessment;
  const t = makeTree({ extra: (root) => {
    const s0 = loadStore(root, { allowFixtures: true });
    const claim = [...s0.claims.values()][0].at(-1)!;
    const id = claim.claim_id;
    const body = screenContractBody(claim);
    if (over.tamperContract) body.explicit_source_elements = ["he promised AGI by 2025"];
    const contract = sealContract({ claim_id: id, version: 2, claim_revision_ref: claimRef(claim), ...body, policy_version: "2026-10-28.7", written_at: T, frozen_at: T });
    write(root, `contracts/${id}/2.yaml`, contract);
    const packet = sealPacket({ packet_id: `${id}-p9`, claim_revision_ref: claimRef(claim), contract_ref: contractRef(contract), evaluation_as_of: "2026-10-28", search_record: { queries: [], sources_considered: [], performed_at: T }, evidence_items: [], material_counterevidence: [], unresolved_gaps: [] });
    write(root, `evidence/${packet.packet_id}.json`, packet);
    const s1 = loadStore(root, { allowFixtures: true });
    const digest = claimDigest(s1, claim, "2026-10-28.7", PH);
    const sa = run("fx-sa", "screen", "anthropic", { prompt: PH, [`claim:${id}`]: over.staleA ? "d".repeat(64) : digest }, { entries: [entry(id, { proposed_kind: claim.kind, ...over.a })] }, { prompt_hash: PH });
    const so = run("fx-so", "screen", "openai", { prompt: PH, [`claim:${id}`]: digest }, { entries: [entry(id, { proposed_kind: claim.kind, reason: "value_judgment", ...over.o })] }, { prompt_hash: PH });
    write(root, "reviews/fx-sa.json", sa);
    write(root, "reviews/fx-so.json", so);
    const payload = screenPayload(s1, claim, contract, packet, (over.reasons ?? ["no_plain_reading", "value_judgment"]) as never)!;
    if (over.editPayload) payload.rationale += " It was obviously wrong.";
    const runs = over.onlyOne ? ["fx-sa"] : over.mixReview ? ["fx-sa", "fx-rb"] : ["fx-sa", "fx-so"];
    assessment = sealAssessment({
      assessment_id: "fx-screened", claim_revision_ref: claimRef(claim), contract_ref: contractRef(contract), packet_ref: packetRef(packet), axis: "not_applicable", outcome: "not_adjudicable",
      horizon_state: "not_applicable", evaluation_as_of: "2026-10-28", target_period: null, public_rationale: payload.rationale, evidence_ids: [], counterevidence_ids: [], limitations: [],
      drafter: { provider: "anthropic", model: "fx" }, reviewer_run_ids: runs, final_text_run_id: null, policy_version: "2026-10-28.7", public_payload: payload,
      supersedes_assessment_id: null, next_review_due_at: null, conclusive_event: null, recorded_at: T,
    });
    write(root, "assessments/fx-screened.json", assessment);
  } });
  return gate(t.store, t.store.assessments.get("fx-screened")!);
}

test("a claim both screens find uncheckable publishes on code-composed text", () => {
  const g = screened();
  assert.equal(g.result, "published", JSON.stringify(g));
});

test("the screen path holds on any doubt", () => {
  assert.equal(screened({ o: { checkable: true, reason: null, test: "x", timing: "now" } }).reason, "assessment_disagreement");
  assert.equal(screened({ a: { endorsed: false } }).reason, "attribution_uncertain");
  assert.equal(screened({ o: { proposition_faithful: false } }).reason, "semantic_disagreement");
  assert.equal(screened({ a: { proposed_kind: "observation" } }).reason, "semantic_disagreement");
  assert.equal(screened({ staleA: true }).reason, "stale_binding");
  assert.equal(screened({ editPayload: true }).reason, "stale_binding");
  // Reasons in the text must be the screens' own reasons.
  assert.equal(screened({ reasons: ["rhetoric", "value_judgment"] }).reason, "stale_binding");
  assert.equal(screened({ onlyOne: true }).reason, "verification_unavailable");
  assert.equal(screened({ mixReview: true }).reason, "verification_unavailable");
  // Words attributed to the speaker on the page must come from the claim, not from an edited contract.
  assert.equal(screened({ tamperContract: true }).reason, "policy_mismatch");
});

type BatchOver = { dropCaseKey?: boolean; duplicate?: boolean; sameRunTwice?: boolean; finalOther?: boolean; dropPayloadKey?: boolean };

// The base case, reviewed in batches: two batch reviews and a batch final check,
// each carrying an answer for an unrelated claim as well.
function batched(over: BatchOver = {}) {
  const t = makeTree({ extra: (root, c) => {
    const s0 = loadStore(root, { allowFixtures: true });
    const id = c.claim.claim_id;
    const dig = caseDigest(s0, c.claim, c.contract, c.packet, c.assessment.policy_version, "a".repeat(64));
    const r = review({ axis: c.assessment.axis, horizon_state: c.assessment.horizon_state, outcome: c.assessment.outcome, evidence: c.packet.evidence_items.map((i) => ({ id: i.id, fits: true, relation: i.relation, note: "ok" })) });
    const other = { ...review({ outcome: "contradicted" }), claim_id: "fx-other" };
    const inputs: Record<string, string> = { prompt: "a".repeat(64), "case:fx-other": "e".repeat(64) };
    if (!over.dropCaseKey) inputs[`case:${id}`] = dig;
    const mine = over.duplicate ? [{ ...r, claim_id: id }, { ...r, outcome: "contradicted" as const, claim_id: id }] : [{ ...r, claim_id: id }];
    write(root, "reviews/fx-ba.json", run("fx-ba", "batch_review", "anthropic", inputs, { reviews: [other, ...mine] }));
    write(root, "reviews/fx-bo.json", run("fx-bo", "batch_review", "openai", { prompt: "a".repeat(64), [`case:${id}`]: dig }, { reviews: [{ ...r, claim_id: id }, other] }));
    const a0 = sealAssessment({ ...c.assessment, assessment_id: "fx-batched", reviewer_run_ids: over.sameRunTwice ? ["fx-ba", "fx-ba"] : ["fx-ba", "fx-bo"], final_text_run_id: "fx-bf" });
    const check = { excerpt_matches: true, proposition_faithful: true, conditions_shown: true, rationale_supported_by_evidence: true, outcome_matches_reviews: true, citations_correct: true, overclaims: [], verdict: "pass", note: "ok" };
    const finputs: Record<string, string> = { prompt: "a".repeat(64), [`case:${id}`]: dig };
    if (!over.dropPayloadKey) finputs[`payload:${id}`] = hashOf(a0.public_payload);
    write(root, "reviews/fx-bf.json", run("fx-bf", "batch_final_text", over.finalOther ? "anthropic" : "openai", finputs, { checks: [{ ...check, claim_id: id }] }));
    write(root, "assessments/fx-batched.json", a0);
  } });
  return gate(t.store, t.store.assessments.get("fx-batched")!);
}

test("claims reviewed several to a call publish on their own bound answers", () => {
  const g = batched();
  assert.equal(g.result, "published", JSON.stringify(g));
});

test("a batch answer counts only for its own claim, once, under its own binding", () => {
  assert.equal(batched({ dropCaseKey: true }).reason, "stale_binding");
  assert.equal(batched({ duplicate: true }).reason, "malformed_review");
  assert.equal(batched({ sameRunTwice: true }).reason, "verification_unavailable");
  assert.equal(batched({ finalOther: true }).reason, "verification_unavailable");
  assert.equal(batched({ dropPayloadKey: true }).reason, "stale_binding");
});
