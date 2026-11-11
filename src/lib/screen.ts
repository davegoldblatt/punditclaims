// The screen (policy .7): both providers read each post with the claims
// extracted from it and say, for every claim, whether public evidence could
// settle it at all. A claim both find uncheckable gets a contract, an empty
// evidence packet, and public text composed here, by code, from the screen.
// The gate recomputes the text and refuses anything that differs, so no model
// writes prose for a screened-out claim.
import { UNCHECKABLE_LABEL, type UncheckableReason } from "../policy.ts";
import type { ClaimRevision, EvidencePacket, PublicPayload, ResolutionContract } from "../schema.ts";
import type { Store } from "./data.ts";
import { hashOf } from "./canonical.ts";

export const SCREEN_CONDITION = "Not checked against evidence: both screens found that public evidence could not settle this claim.";

// The contract body for a screened-out claim. Only what the speaker stated is
// recorded; nothing is added to make it testable.
export function screenContractBody(claim: ClaimRevision) {
  return {
    assessment_axis: "not_applicable" as const,
    explicit_source_elements: [...claim.conditions.map((c) => c.text), ...(claim.original_horizon_text ? [claim.original_horizon_text] : []), ...(claim.original_threshold ? [claim.original_threshold] : [])].map((x) => x.slice(0, 300)),
    evaluator_interpretation: [],
    support_condition: SCREEN_CONDITION,
    contradiction_condition: SCREEN_CONDITION,
    measurement_requirements: null, source_requirements: null, metric_scope: null,
    original_horizon: claim.original_horizon_text, horizon_interval: null, target_period: null,
    // A conditional forecast always records whether its antecedent happened; unchecked, that is unknown.
    condition_status: claim.kind === "conditional_forecast" ? ("unknown" as const) : ("not_applicable" as const), early_resolution_rule: null, interpretation_determines_result: false,
    ambiguity_flags: [], retrospective_or_prospective: "retrospective" as const, outcome_known_at_freeze: false,
  };
}

export const isScreenContract = (k: ResolutionContract) =>
  k.assessment_axis === "not_applicable" && k.support_condition === SCREEN_CONDITION && k.contradiction_condition === SCREEN_CONDITION && !k.evaluator_interpretation.length;

// The gate's check: every field of the contract is what code composes for this
// exact claim revision, so nothing in it (such as the speaker's stated
// elements shown on the page) can differ from the claim.
export function isComposedScreenContract(k: ResolutionContract, claim: ClaimRevision): boolean {
  const { claim_id, version: _v, claim_revision_ref, written_at: _w, frozen_at: _f, policy_version: _p, content_hash: _h, ...rest } = k;
  return claim_id === claim.claim_id && claim_revision_ref.content_hash === claim.content_hash && hashOf(rest) === hashOf(screenContractBody(claim));
}

export function screenRationale(reasons: (UncheckableReason | null)[]): string {
  const [a, b] = reasons;
  if (!a || !b) return "Held before grading: the two screens did not agree on this record.";
  if (a === b) return `Not checked against evidence. Two independent screens, one from each provider, both found this ${UNCHECKABLE_LABEL[a]}.`;
  return `Not checked against evidence. Two independent screens, one from each provider, both found that evidence could not settle it: one found it ${UNCHECKABLE_LABEL[a]}; the other found it ${UNCHECKABLE_LABEL[b]}.`;
}

// reasons: [anthropic's, openai's], in that order.
export function screenPayload(s: Store, claim: ClaimRevision, contract: ResolutionContract, packet: EvidencePacket, reasons: (UncheckableReason | null)[]): PublicPayload | null {
  const o = s.occurrences.get(claim.occurrence_ids[0]);
  const doc = o && s.documents.get(o.document_id);
  const v = o && s.versions.get(o.source_version_receipts[0].source_snapshot_id);
  if (!o || !doc || !v) return null;
  const r = o.source_version_receipts[0];
  return {
    claim_id: claim.claim_id, subject_id: claim.subject_id, normalized_proposition: claim.normalized_proposition, kind: claim.kind,
    conditions: claim.conditions.map((c) => c.text), original_horizon_text: claim.original_horizon_text,
    statement: { excerpt: r.public_excerpt, locator: r.excerpt_locator, url: doc.canonical_url, date: o.statement_date, document_title: doc.title, observed_at: v.first_observed_at },
    criteria: { from_speaker: contract.explicit_source_elements, our_interpretation: [], support_condition: contract.support_condition, contradiction_condition: contract.contradiction_condition },
    axis: "not_applicable", outcome: "not_adjudicable", horizon_state: "not_applicable", evaluation_as_of: packet.evaluation_as_of,
    rationale: screenRationale(reasons), limitations: [], evidence: [], what_would_resolve: null, retrospective: true,
    uncheckable: [...new Set(reasons.filter((r): r is UncheckableReason => !!r))].sort(),
  };
}
