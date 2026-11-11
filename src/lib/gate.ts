// The publication gate. Trusted, deterministic code: given an assessment and
// the records it binds to, decide published or held, and say why. No model
// decides this. Every check fails closed: a missing record, a malformed
// answer, an outage, a disagreement, or a changed text holds the assessment.
// There is no exception for older records.
import { AXES_FOR_KIND, FULL_ACCESS, type HeldReason } from "../policy.ts";
import type { Assessment, BatchFinalOutput, BatchReviewOutput, ClaimRevision, EvidencePacket, FinalTextOutput, ResolutionContract, ReviewOutput, ReviewRun, ScreenOutput } from "../schema.ts";
import { hashOf } from "./canonical.ts";
import type { Store } from "./data.ts";
import { contractByHash, revisionByHash } from "./data.ts";
import { checkCase, outcomeItems } from "./rules.ts";
import { caseDigest, claimDigest } from "./binding.ts";
import { isComposedScreenContract, screenPayload } from "./screen.ts";

export type GateResult = { result: "published"; reason: null; detail: string } | { result: "held"; reason: HeldReason; detail: string };
const hold = (reason: HeldReason, detail: string): GateResult => ({ result: "held", reason, detail: detail.slice(0, 600) });

const isReview = (o: unknown): o is ReviewOutput => !!o && typeof o === "object" && "outcome" in o && "semantics" in o;
const isFinal = (o: unknown): o is FinalTextOutput => !!o && typeof o === "object" && "verdict" in o;
const isScreen = (o: unknown): o is ScreenOutput => !!o && typeof o === "object" && "entries" in o;

// One claim's answer from a run: the whole output of a single-claim run, or
// the claim's own entry (exactly one) in a batch, with the hashes it is bound to.
function answerFor(r: ReviewRun, claimId: string): { output: unknown; caseHash: string | undefined; payloadHash: string | undefined } | null {
  if (r.kind === "assessment_review" || r.kind === "final_text_verification") return { output: r.output, caseHash: r.input_hashes.case, payloadHash: r.input_hashes.payload };
  const list = r.kind === "batch_review" ? (r.output as BatchReviewOutput | null)?.reviews : r.kind === "batch_final_text" ? (r.output as BatchFinalOutput | null)?.checks : undefined;
  const mine = (list ?? []).filter((e) => e.claim_id === claimId);
  if (mine.length !== 1) return null;
  const { claim_id: _id, ...output } = mine[0];
  return { output, caseHash: r.input_hashes[`case:${claimId}`], payloadHash: r.input_hashes[`payload:${claimId}`] };
}

export function gate(s: Store, a: Assessment): GateResult {
  const claimId = a.claim_revision_ref.id;
  const claim = revisionByHash(s, claimId, a.claim_revision_ref.content_hash);
  const contract = contractByHash(s, claimId, a.contract_ref.content_hash);
  const packet = s.packets.get(a.packet_ref.id);
  if (!claim || !contract || !packet || packet.packet_hash !== a.packet_ref.content_hash) return hold("stale_binding", "The assessment does not bind to the current claim, contract, and evidence records.");
  if (hashOf(a.public_payload) !== a.public_payload_hash) return hold("stale_binding", "The public text changed after it was sealed.");
  // Publication uses the latest revision and contract only.
  if (s.claims.get(claimId)!.at(-1)!.content_hash !== claim.content_hash || s.contracts.get(claimId)!.at(-1)!.content_hash !== contract.content_hash) {
    return hold("stale_binding", "A newer claim revision or contract exists; this assessment was made against an older one.");
  }
  if (!s.subjects.has(claim.subject_id)) return hold("policy_mismatch", `Unknown subject ${claim.subject_id}.`);

  // The statement: endorsed by the subject, quoted exactly from a full version.
  for (const oid of claim.occurrence_ids) {
    const o = s.occurrences.get(oid);
    if (!o) return hold("attribution_uncertain", `Statement ${oid} is missing.`);
    if (o.endorsement_status !== "endorsed" || o.attributed_speaker !== claim.subject_id) return hold("attribution_uncertain", "The statement is not one the subject made and endorsed.");
    for (const r of o.source_version_receipts) {
      const v = s.versionsByDoc.get(`${o.document_id}/${r.source_snapshot_id}`);
      if (!v) return hold("source_unavailable", "The observed source version is missing.");
      if (!FULL_ACCESS.has(v.access_state) || v.context_completeness !== "complete") return hold("source_partial", "The quotation was checked against a partial or preview copy of the source.");
      if (r.quote_verification.status === "failed" || !r.quote_verification.excerpt_in_quote) return hold("quote_mismatch", "The quotation did not match the observed source.");
    }
  }
  for (const i of outcomeItems(packet.evidence_items)) {
    const v = s.versionsByDoc.get(`${i.document_id}/${i.source_snapshot_id}`);
    if (!v || !FULL_ACCESS.has(v.access_state)) return hold("evidence_incomplete", `Evidence ${i.id} was not read from a full copy of its source.`);
  }

  // The rules that code enforces.
  const problems = checkCase({ claim, contract, packet, assessment: a });
  if (problems.length) return hold("policy_mismatch", problems.map((p) => p.problem).join("; "));

  // A claim screened out by both providers takes the screen path.
  const all = a.reviewer_run_ids.map((id) => s.reviews.get(id));
  if (all.some((r) => r?.kind === "screen")) return screenGate(s, a, claim, contract, packet, all);

  // Two independent reviews from two providers, both valid, both bound to these inputs.
  const runs = a.reviewer_run_ids.map((id) => s.reviews.get(id)).filter((r): r is ReviewRun => !!r && (r.kind === "assessment_review" || r.kind === "batch_review"));
  if (runs.length !== 2 || runs[0].provider === runs[1].provider) return hold("verification_unavailable", "Two reviews from two different providers are required.");
  const outs: ReviewOutput[] = [];
  for (const r of runs) {
    if (r.status === "budget") return hold("budget_exhausted", `The ${r.provider} review stopped at its budget.`);
    if (r.status === "unavailable" || r.status === "timeout" || r.status === "error") return hold("verification_unavailable", `The ${r.provider} review could not run (${r.status}).`);
    const got = answerFor(r, claimId);
    if (r.status !== "ok" || !got || !isReview(got.output)) return hold("malformed_review", `The ${r.provider} review returned an unusable answer for this claim.`);
    if (r.kind === "assessment_review") {
      const h = r.input_hashes;
      if (h.claim !== claim.content_hash || h.contract !== contract.content_hash || h.packet !== packet.packet_hash) return hold("stale_binding", `The ${r.provider} review was made against different inputs.`);
    }
    if (got.caseHash !== caseDigest(s, claim, contract, packet, a.policy_version, r.prompt_hash)) return hold("stale_binding", `The ${r.provider} review is not bound to this exact case: a statement, its source, the policy version, or the prompt differs.`);
    outs.push(got.output);
  }
  const [A, B] = outs;
  for (const [r, o] of [[runs[0], A], [runs[1], B]] as const) {
    if (o.abstain) return hold("criteria_ambiguous", `The ${r.provider} review abstained.`);
    if (!o.attribution.speaker_is_subject || !o.attribution.endorsed) return hold("attribution_uncertain", `The ${r.provider} review doubts the attribution.`);
    if (!o.contract.fair_to_speaker) return hold("criteria_ambiguous", `The ${r.provider} review found the criteria unfair to the speaker's words.`);
    if (!o.semantics.proposition_faithful || !o.semantics.conditions_preserved || !o.semantics.kind_correct || o.semantics.proposed_kind !== claim.kind) {
      return hold("semantic_disagreement", `The ${r.provider} review reads the claim differently.`);
    }
    // Contrary evidence matters only where a verdict is given.
    if (!o.counterevidence_considered && ["supported", "contradicted", "mixed"].includes(a.outcome)) return hold("evidence_incomplete", `The ${r.provider} review did not find counterevidence considered.`);
  }
  // When both reviews and the draft agree a claim cannot be scored, the axis
  // and horizon are labels, not findings: either allowed axis is accepted.
  const allUnscored = A.outcome === "not_adjudicable" && B.outcome === "not_adjudicable" && a.outcome === "not_adjudicable";
  if (allUnscored) {
    for (const [r, o] of [[runs[0], A], [runs[1], B]] as const) if (!AXES_FOR_KIND[claim.kind].includes(o.axis)) return hold("semantic_disagreement", `The ${r.provider} review puts a ${claim.kind} claim on the ${o.axis} axis.`);
  } else if (A.axis !== B.axis || A.horizon_state !== B.horizon_state || A.outcome !== B.outcome) {
    return hold("assessment_disagreement", `The two reviews differ: ${runs[0].provider} ${A.axis}/${A.horizon_state}/${A.outcome}, ${runs[1].provider} ${B.axis}/${B.horizon_state}/${B.outcome}.`);
  }
  if (!allUnscored && (A.axis !== a.axis || A.horizon_state !== a.horizon_state || A.outcome !== a.outcome)) {
    return hold("assessment_disagreement", `Both reviews say ${A.axis}/${A.horizon_state}/${A.outcome}; the drafted assessment says ${a.axis}/${a.horizon_state}/${a.outcome}.`);
  }
  // Every decisive item: both reviewers say it fits and agree on its relation.
  for (const i of outcomeItems(packet.evidence_items).filter((x) => a.evidence_ids.includes(x.id))) {
    for (const [r, o] of [[runs[0], A], [runs[1], B]] as const) {
      const e = o.evidence.find((x) => x.id === i.id);
      if (!e || !e.fits || e.relation !== i.relation) return hold("assessment_disagreement", `The ${r.provider} review does not accept ${i.id} as ${i.relation}.`);
    }
  }

  // The final text, checked by a provider other than the drafter's, bound to this exact payload.
  const ft = a.final_text_run_id ? s.reviews.get(a.final_text_run_id) : undefined;
  if (!ft || (ft.kind !== "final_text_verification" && ft.kind !== "batch_final_text")) return hold("verification_unavailable", "The final public text has not been checked.");
  if (ft.provider === a.drafter.provider) return hold("verification_unavailable", "The final text was checked by the drafter's own provider.");
  if (ft.status === "budget") return hold("budget_exhausted", "The final-text check stopped at its budget.");
  if (ft.status !== "ok") return hold(ft.status === "malformed" ? "malformed_review" : "verification_unavailable", `The final-text check did not complete (${ft.status}).`);
  const fgot = answerFor(ft, claimId);
  if (!fgot || !isFinal(fgot.output)) return hold("malformed_review", "The final-text check returned an unusable answer for this claim.");
  if (fgot.payloadHash !== a.public_payload_hash) return hold("stale_binding", "The public text changed after its final check.");
  if (fgot.caseHash !== caseDigest(s, claim, contract, packet, a.policy_version, ft.prompt_hash)) return hold("stale_binding", "The final-text check is not bound to this exact case.");
  const F = fgot.output;
  const failed = (["excerpt_matches", "proposition_faithful", "conditions_shown", "rationale_supported_by_evidence", "outcome_matches_reviews", "citations_correct"] as const).filter((k) => !F[k]);
  if (F.verdict !== "pass" || failed.length || F.overclaims.length) {
    return hold("semantic_disagreement", `The final-text check failed${failed.length ? `: ${failed.join(", ")}` : ""}${F.overclaims.length ? `; overclaims: ${F.overclaims.join(" | ")}` : ""}.`);
  }
  return { result: "published", reason: null, detail: "Both reviews agree with the drafted assessment, every rule holds, and the final text passed its check." };
}

// The screen path (policy .7). Both providers screened the claim, both bound to
// this exact claim and its statements, both confirm the attribution and the
// reading, and both find it uncheckable. The contract, the empty packet, and
// the public text must be exactly what code composes from those screens.
function screenGate(s: Store, a: Assessment, claim: ClaimRevision, contract: ResolutionContract, packet: EvidencePacket, all: (ReviewRun | undefined)[]): GateResult {
  const runs = all.filter((r): r is ReviewRun => !!r && r.kind === "screen");
  if (runs.length !== all.length || runs.length !== 2 || runs[0].provider === runs[1].provider) return hold("verification_unavailable", "Two screens from two different providers are required.");
  runs.sort((x, y) => (x.provider < y.provider ? -1 : 1)); // anthropic, then openai
  const id = claim.claim_id;
  const reasons = [];
  for (const r of runs) {
    if (r.status === "budget") return hold("budget_exhausted", `The ${r.provider} screen stopped at its budget.`);
    if (r.status !== "ok" || !isScreen(r.output)) return hold(r.status === "malformed" ? "malformed_review" : "verification_unavailable", `The ${r.provider} screen did not complete (${r.status}).`);
    if (r.input_hashes[`claim:${id}`] !== claimDigest(s, claim, a.policy_version, r.prompt_hash)) return hold("stale_binding", `The ${r.provider} screen is not bound to this exact claim and its statements.`);
    const es = r.output.entries.filter((e) => e.claim_id === id);
    if (es.length !== 1) return hold("malformed_review", `The ${r.provider} screen has ${es.length} answers for this claim.`);
    const e = es[0];
    if (!e.speaker_is_subject || !e.endorsed) return hold("attribution_uncertain", `The ${r.provider} screen doubts the attribution.`);
    if (!e.proposition_faithful || !e.kind_correct || e.proposed_kind !== claim.kind) return hold("semantic_disagreement", `The ${r.provider} screen reads the claim differently.`);
    if (e.checkable || !e.reason) return hold("assessment_disagreement", `The ${r.provider} screen finds the claim checkable, so it must be graded.`);
    reasons.push(e.reason);
  }
  if (a.outcome !== "not_adjudicable" || a.axis !== "not_applicable" || a.horizon_state !== "not_applicable") return hold("policy_mismatch", "A screened-out claim records not_adjudicable on no axis.");
  if (!isComposedScreenContract(contract, claim) || packet.evidence_items.length || a.evidence_ids.length || packet.contract_ref.content_hash !== contract.content_hash) return hold("policy_mismatch", "A screened-out claim has exactly the composed screen contract and no evidence.");
  const expected = screenPayload(s, claim, contract, packet, reasons);
  if (!expected || hashOf(expected) !== a.public_payload_hash) return hold("stale_binding", "The public text is not the text composed from the two screens.");
  return { result: "published", reason: null, detail: "Both screens confirm the attribution and the reading and find the claim uncheckable; the text is composed from them by code." };
}
