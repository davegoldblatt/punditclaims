// A complete synthetic data tree for one claim: statement, source version,
// claim, contract, packet, two reviews, a final-text check, and an
// assessment that passes the gate. Tests change one thing and expect one
// specific hold. Every id starts with "fx-"; nothing here is real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { buildCase, T } from "./case.ts";
import { loadStore, type Store } from "../../src/lib/data.ts";
import { sealAssessment } from "../../src/lib/records.ts";
import { hashOf } from "../../src/lib/canonical.ts";
import { caseDigest } from "../../src/lib/binding.ts";
import type { Assessment, ReviewOutput, ReviewRun } from "../../src/schema.ts";

const SNAP = "e".repeat(64);
const QH = "f".repeat(64);

export function review(over: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    attribution: { speaker_is_subject: true, endorsed: true, note: "ok" },
    semantics: { proposition_faithful: true, conditions_preserved: true, kind_correct: true, proposed_kind: "forecast", note: "ok" },
    contract: { fair_to_speaker: true, interpretation_determines_result: false, note: "ok" },
    evidence: [{ id: "fx-ev-1", fits: true, relation: "supports", note: "ok" }],
    counterevidence_considered: true, axis: "forecast_outcome", horizon_state: "elapsed", outcome: "supported", rationale: "ok", abstain: false, abstain_reason: null, ...over,
  };
}

type RunOver = Partial<ReviewRun> & { output?: unknown };
export type TreeOptions = {
  reviewA?: RunOver; reviewB?: RunOver; finalText?: RunOver | null; access?: string;
  assessment?: Parameters<typeof buildCase>[0]["assessment"]; contract?: Parameters<typeof buildCase>[0]["contract"]; claim?: Parameters<typeof buildCase>[0]["claim"]; packet?: Parameters<typeof buildCase>[0]["packet"];
  extra?: (root: string, c: ReturnType<typeof buildCase>) => void;
};

function write(root: string, rel: string, body: unknown) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, rel.endsWith(".json") ? JSON.stringify(body, null, 1) : YAML.stringify(body));
}

export function run(id: string, kind: ReviewRun["kind"], provider: "anthropic" | "openai", inputs: Record<string, string>, output: unknown, over: RunOver = {}): ReviewRun {
  return { run_id: id, kind, provider, model_requested: `fx-${provider}`, model_returned: `fx-${provider}`, via: "api", prompt_version: "fx", prompt_hash: "a".repeat(64), rubric_version: "fx",
    input_hashes: inputs, started_at: T, completed_at: T, status: "ok", output: output as ReviewRun["output"], error: null, usage: null, cost_usd: null, ...over } as ReviewRun;
}

export function makeTree(o: TreeOptions = {}): { root: string; store: Store; assessment: Assessment; reload: () => Store } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-tree-"));
  const c = buildCase({ claim: o.claim, contract: o.contract, packet: o.packet, assessment: o.assessment });
  for (const id of ["gary-marcus", "ed-zitron"]) write(root, `subjects/${id}.yaml`, { id, name: id, identification: "x", identification_source: { title: "x", url: "https://example.org" }, statement_origins: ["https://example.org"], collection_windows: ["x"], active: true, profile_links: [] });
  for (const doc of ["fx-doc", "fx-doc-outcome"]) {
    write(root, `sources/${doc}/document.yaml`, { document_id: doc, canonical_url: `https://example.org/${doc}`, title: doc, publisher: "Fixture", original_author: doc === "fx-doc" ? "gary-marcus" : "Fixture Co", source_type: "newsletter", original_published_at: "2024-01-01", original_date_precision: "day", original_date_provenance: "article:published_time meta", original_date_uncertain: false, discovered_at: T });
  }
  const access = o.access ?? "full_public";
  write(root, `sources/fx-doc/versions/${SNAP}.json`, { snapshot_hash: SNAP, document_id: "fx-doc", first_observed_at: T, observed_via: "live", archive_url: null, archive_captured_at: null, access_state: access, context_completeness: access === "full_public" ? "complete" : "partial", parser_version: "1", normalization_version: "1", chars: 6000, public_excerpt_policy: { max_words: 40 }, private_retained: true });
  write(root, `sources/fx-doc-outcome/versions/${"b".repeat(64)}.json`, { snapshot_hash: "b".repeat(64), document_id: "fx-doc-outcome", first_observed_at: T, observed_via: "live", archive_url: null, archive_captured_at: null, access_state: "full_public", context_completeness: "complete", parser_version: "1", normalization_version: "1", chars: 6000, public_excerpt_policy: { max_words: 40 }, private_retained: true });
  write(root, "occurrences/fx-occ.yaml", { id: "fx-occ", subject_id: c.claim.subject_id, document_id: "fx-doc", attributed_speaker: c.claim.subject_id, endorsement_status: "endorsed", statement_date: "2024-01-01", statement_date_precision: "day", extraction_run: "fx", claim_ids: [c.claim.claim_id], source_version_receipts: [{ source_snapshot_id: SNAP, source_span: { start: 0, end: 40 }, public_excerpt: "Fixture words.", excerpt_locator: "paragraph 1", quote_hash: QH, quote_verification: { status: "exact", normalization_version: "1", verified_at: T, excerpt_in_quote: true } }], continuity: { status: "single", note: null } });
  write(root, `claims/${c.claim.claim_id}/revisions/1.yaml`, c.claim);
  write(root, `contracts/${c.claim.claim_id}/1.yaml`, c.contract);
  write(root, `evidence/${c.packet.packet_id}.json`, c.packet);
  // Write the statement first so the case digest can include it.
  const pre = loadStore(root, { allowFixtures: true });
  const inputs = { claim: c.claim.content_hash, contract: c.contract.content_hash, packet: c.packet.packet_hash, prompt: "a".repeat(64), case: caseDigest(pre, c.claim, c.contract, c.packet, c.assessment.policy_version, "a".repeat(64)) };
  const agreed = { axis: c.assessment.axis, horizon_state: c.assessment.horizon_state, outcome: c.assessment.outcome };
  const A = run("fx-ra", "assessment_review", "anthropic", inputs, review({ ...agreed, evidence: c.packet.evidence_items.map((i) => ({ id: i.id, fits: true, relation: i.relation, note: "ok" })) }), o.reviewA);
  const B = run("fx-rb", "assessment_review", "openai", inputs, review({ ...agreed, evidence: c.packet.evidence_items.map((i) => ({ id: i.id, fits: true, relation: i.relation, note: "ok" })) }), o.reviewB);
  write(root, "reviews/fx-ra.json", A);
  write(root, "reviews/fx-rb.json", B);
  const a: Assessment = sealAssessment({ ...c.assessment, reviewer_run_ids: ["fx-ra", "fx-rb"], final_text_run_id: o.finalText === null ? null : "fx-ft" });
  if (o.finalText !== null) {
    const ft = run("fx-ft", "final_text_verification", "openai", { ...inputs, payload: hashOf(a.public_payload) }, { excerpt_matches: true, proposition_faithful: true, conditions_shown: true, rationale_supported_by_evidence: true, outcome_matches_reviews: true, citations_correct: true, overclaims: [], verdict: "pass", note: "ok" }, o.finalText);
    write(root, "reviews/fx-ft.json", ft);
  }
  write(root, `assessments/${a.assessment_id}.json`, a);
  o.extra?.(root, c);
  const reload = () => loadStore(root, { allowFixtures: true });
  return { root, store: reload(), assessment: a, reload };
}
