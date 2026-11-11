// Synthetic cases for the rule fixtures. Every id starts with "fx-" so a
// fixture can never pass the production loader. The people, quotations, and
// numbers here are invented; none of it describes Gary Marcus or Ed Zitron.
import type { Case } from "../../src/lib/rules.ts";
import { claimRef, contractRef, packetRef, sealAssessment, sealClaim, sealContract, sealPacket } from "../../src/lib/records.ts";
import type { Assessment, ClaimRevision, EvidenceItem, EvidencePacket, ResolutionContract } from "../../src/schema.ts";

const H = (c: string) => c.repeat(64).slice(0, 64);
export const T = "2026-10-28T12:00:00Z";

type ClaimIn = Partial<Omit<ClaimRevision, "content_hash">>;
type ContractIn = Partial<Omit<ResolutionContract, "content_hash" | "claim_revision_ref">>;
type PacketIn = Partial<Omit<EvidencePacket, "packet_hash" | "claim_revision_ref" | "contract_ref">>;
type AssessIn = Partial<Omit<Assessment, "public_payload_hash" | "claim_revision_ref" | "contract_ref" | "packet_ref">>;

export function item(over: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  return {
    role: "evidence_of_outcome", document_id: "fx-doc-outcome", source_snapshot_id: H("b"), publisher: "Fixture Publisher",
    source_type: "company_disclosure", url: "https://example.org/outcome", locator: "paragraph 3",
    receipt: { public_excerpt: "The fixture event happened on the stated day.", quote_hash: H("c"), verified: "exact" },
    event_date: "2025-06-01", available_at: "2025-06-02", retrieved_at: T, relation: "supports",
    explanation: "Fixture explanation.", metric_scope: null, audited: null, derived: null, ...over,
  };
}

export function buildCase(o: { claim?: ClaimIn; contract?: ContractIn; packet?: PacketIn; assessment?: AssessIn } = {}): Case {
  const claim = sealClaim({
    claim_id: "fx-claim", revision: 1, subject_id: "gary-marcus", occurrence_ids: ["fx-occ"],
    normalized_proposition: "Fixture system X will not ship by the end of 2025.", kind: "forecast", target: "fixture system X",
    target_version: null, quantifier: null, modality: "will_not", conditions: [], original_horizon_text: "by the end of 2025",
    original_threshold: null, metric_scope: null, topic_tags: ["capabilities"], concerns_providers: [], relation_to_prior_claim: null, revision_reason: null,
    created_at: T, ...o.claim,
  });
  const contract = sealContract({
    claim_id: claim.claim_id, version: 1, claim_revision_ref: claimRef(claim), assessment_axis: "forecast_outcome",
    explicit_source_elements: ["will not ship", "by the end of 2025"], evaluator_interpretation: [],
    support_condition: "No general release by 2025-12-31.", contradiction_condition: "A general release on or before 2025-12-31.",
    measurement_requirements: null, source_requirements: null, metric_scope: null, original_horizon: "by the end of 2025",
    horizon_interval: { start: null, end: "2025-12-31", precision: "day" }, target_period: null, condition_status: "not_applicable",
    early_resolution_rule: null, interpretation_determines_result: false, ambiguity_flags: [], retrospective_or_prospective: "retrospective", outcome_known_at_freeze: true,
    written_at: T, frozen_at: T, policy_version: "2026-10-28.7", ...o.contract,
  });
  const packet = sealPacket({
    packet_id: "fx-packet", claim_revision_ref: claimRef(claim), contract_ref: contractRef(contract), evaluation_as_of: "2026-10-28",
    search_record: { queries: ["fixture system X release"], sources_considered: [], performed_at: T },
    evidence_items: [item({ id: "fx-ev-1", relation: "supports", event_date: "2025-12-31", available_at: "2026-01-05" })],
    material_counterevidence: [], unresolved_gaps: [], ...o.packet,
  });
  const a: AssessIn = o.assessment ?? {};
  const axis = a.axis ?? contract.assessment_axis;
  const outcome = a.outcome ?? "supported";
  const horizon_state = a.horizon_state ?? "elapsed";
  const assessment = sealAssessment({
    assessment_id: "fx-assessment", claim_revision_ref: claimRef(claim), contract_ref: contractRef(contract), packet_ref: packetRef(packet),
    axis, outcome, horizon_state, evaluation_as_of: packet.evaluation_as_of, target_period: contract.target_period,
    public_rationale: "Fixture rationale.", evidence_ids: packet.evidence_items.map((i) => i.id), counterevidence_ids: [...packet.material_counterevidence],
    limitations: [], drafter: { provider: "anthropic", model: "fixture" }, reviewer_run_ids: [], final_text_run_id: null,
    policy_version: "2026-10-28.7", supersedes_assessment_id: null, next_review_due_at: null, conclusive_event: null, recorded_at: T,
    ...a,
    public_payload: {
      claim_id: claim.claim_id, subject_id: claim.subject_id, normalized_proposition: claim.normalized_proposition, kind: claim.kind,
      conditions: claim.conditions.map((c) => c.text), original_horizon_text: claim.original_horizon_text,
      statement: { excerpt: "Fixture words.", locator: "paragraph 1", url: "https://example.org/statement", date: "2024-01-01", document_title: "Fixture post", observed_at: T },
      criteria: { from_speaker: contract.explicit_source_elements, our_interpretation: contract.evaluator_interpretation, support_condition: contract.support_condition, contradiction_condition: contract.contradiction_condition },
      axis, outcome, horizon_state, evaluation_as_of: packet.evaluation_as_of, rationale: "Fixture rationale.", limitations: [], evidence: [],
      what_would_resolve: null, retrospective: contract.retrospective_or_prospective === "retrospective",
      ...(a.public_payload ?? {}),
    },
  });
  return { claim, contract, packet, assessment };
}
