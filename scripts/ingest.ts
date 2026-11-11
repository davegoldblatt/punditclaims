// node scripts/ingest.ts <claim-id>...   Turns private drafts into sealed public
// records and reports what the rules would refuse about the proposal.
import { ingestDraft, readDraft } from "./lib/draft.ts";
import { checkCase } from "../src/lib/rules.ts";
import { sealAssessment, claimRef, contractRef, packetRef } from "../src/lib/records.ts";

for (const id of process.argv.slice(2)) {
  console.log(`${id}:`);
  const r = await ingestDraft(id, (s) => console.log(s));
  for (const p of r.problems) console.log(`  PROBLEM ${p}`);
  if (r.held) console.log(`  would hold: ${r.held}`);
  if (!r.claim || !r.contract || !r.packet) continue;
  const d = readDraft(id);
  // A provisional assessment from the proposal, only to run the rules early.
  const a = sealAssessment({
    assessment_id: `${id}-provisional`, claim_revision_ref: claimRef(r.claim), contract_ref: contractRef(r.contract), packet_ref: packetRef(r.packet),
    axis: r.contract.assessment_axis, outcome: d.proposal.outcome, horizon_state: d.proposal.horizon_state, evaluation_as_of: r.packet.evaluation_as_of,
    target_period: r.contract.target_period, public_rationale: d.proposal.rationale, evidence_ids: r.packet.evidence_items.map((i) => i.id),
    counterevidence_ids: r.packet.material_counterevidence, limitations: d.proposal.limitations, drafter: { provider: "anthropic", model: "provisional" },
    reviewer_run_ids: [], final_text_run_id: null, policy_version: r.contract.policy_version, supersedes_assessment_id: null, next_review_due_at: null,
    conclusive_event: d.proposal.conclusive_event, recorded_at: r.contract.frozen_at,
    public_payload: { claim_id: id, subject_id: r.claim.subject_id, normalized_proposition: r.claim.normalized_proposition, kind: r.claim.kind, conditions: [], original_horizon_text: null, statement: { excerpt: d.statements[0].excerpt, locator: d.statements[0].locator, url: d.statements[0].url, date: "2000-01-01", document_title: "", observed_at: r.contract.frozen_at }, criteria: { from_speaker: [], our_interpretation: [], support_condition: "", contradiction_condition: "" }, axis: r.contract.assessment_axis, outcome: d.proposal.outcome, horizon_state: d.proposal.horizon_state, evaluation_as_of: r.packet.evaluation_as_of, rationale: d.proposal.rationale, limitations: [], evidence: [], what_would_resolve: null, retrospective: true },
  });
  const problems = checkCase({ claim: r.claim, contract: r.contract, packet: r.packet, assessment: a });
  for (const p of problems) console.log(`  RULE ${p.rule}: ${p.problem}`);
  console.log(`  packet ${r.packet.packet_id} · ${r.packet.evidence_items.length} evidence items · ${problems.length ? "rules would refuse the proposal" : "rules accept the proposal"}`);
}
