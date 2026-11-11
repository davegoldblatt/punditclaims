// node scripts/screened.ts
// Acts on the screens (policy .7). For every claim with a successful screen
// from both providers:
// - both confirm the record and both find it uncheckable: write the screen
//   contract, an empty evidence packet, and an assessment whose public text is
//   composed by code, then run the gate on it;
// - otherwise: queue it for grading, for a fix to its normalised proposition
//   or kind, or note the attribution doubt.
// Writes research/corpus/screen-results.jsonl, one line per extracted claim.
import { evaluationDateFor } from "./lib/evaluation.ts";
import fs from "node:fs";
import { CONFIG } from "../src/config.ts";
import { POLICY_VERSION, type UncheckableReason } from "../src/policy.ts";
import { Assessment, EvidencePacket, ResolutionContract, type ClaimRevision, type ScreenEntry, type ScreenOutput } from "../src/schema.ts";
import { loadStore } from "../src/lib/data.ts";
import { hashOf } from "../src/lib/canonical.ts";
import { claimRef, contractRef, packetRef, sealAssessment, sealContract, sealPacket } from "../src/lib/records.ts";
import { gate } from "../src/lib/gate.ts";
import { screenContractBody, screenPayload } from "../src/lib/screen.ts";
import { nowStamp } from "./lib/capture.ts";
import { writePublic } from "./lib/writer.ts";
import { claimsByPost, currentScreen, screenPromptHash } from "./screen.ts";

const EXTRACTOR = { provider: "anthropic" as const, model: "claude-opus-5-5" };
const ph = screenPromptHash();
let s = loadStore("data");
type Line = { claim_id: string; post: string; status: "pending" | "screened_out" | "grade" | "fix" | "split" | "attribution"; reasons: (UncheckableReason | null)[]; tests: (string | null)[]; timing: (string | null)[]; notes: string[]; gate: string | null };
const lines: Line[] = [];
const kept = new Set(fs.existsSync("research/corpus/fix-kept.jsonl") ? fs.readFileSync("research/corpus/fix-kept.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).content_hash) : []);
// Screened-out claims, and terminal holds (attribution doubts, splits after the
// fix round), all get the screen records: the gate publishes the first and
// holds the others with their reason, so every claim appears in the release.
const toRecord: { c: ClaimRevision; runs: string[]; reasons: (UncheckableReason | null)[] }[] = [];

for (const [post, claims] of claimsByPost(s)) for (const c of claims) {
  const runs = (["anthropic", "openai"] as const).map((p) => currentScreen(s, c, p, ph));
  const line: Line = { claim_id: c.claim_id, post, status: "pending", reasons: [], tests: [], timing: [], notes: [], gate: null };
  lines.push(line);
  if (runs.some((r) => !r)) continue;
  const es = runs.map((r) => (r!.output as ScreenOutput).entries.filter((e) => e.claim_id === c.claim_id));
  if (es.some((e) => e.length !== 1)) { line.notes.push("a screen did not answer for this claim exactly once"); continue; }
  const [A, B] = es.map((e) => e[0]) as [ScreenEntry, ScreenEntry];
  line.reasons = [A.reason, B.reason]; line.tests = [A.test, B.test]; line.timing = [A.timing, B.timing]; line.notes = [A.note, B.note];
  if ([A, B].some((e) => !e.speaker_is_subject || !e.endorsed)) { line.status = "attribution"; toRecord.push({ c, runs: runs.map((r) => r!.run_id), reasons: [A.reason, B.reason] }); }
  // One fix round: a revised claim the screens still read differently stays held.
  else if ([A, B].some((e) => !e.proposition_faithful || !e.kind_correct || e.proposed_kind !== c.kind)) {
    line.status = c.revision >= 2 || kept.has(c.content_hash) ? "split" : "fix";
    if (line.status === "split") toRecord.push({ c, runs: runs.map((r) => r!.run_id), reasons: [A.reason, B.reason] });
  }
  else if (A.checkable || B.checkable || !A.reason || !B.reason) line.status = "grade";
  else { line.status = "screened_out"; toRecord.push({ c, runs: runs.map((r) => r!.run_id), reasons: [A.reason, B.reason] }); }
}

// Records for screened-out claims. Existing identical records are reused.
let wrote = 0;
const now = nowStamp();
for (const { c, runs, reasons } of toRecord) {
  const contracts = s.contracts.get(c.claim_id) ?? [];
  const kBody = { claim_id: c.claim_id, claim_revision_ref: claimRef(c), ...screenContractBody(c), policy_version: POLICY_VERSION };
  const strip = (k: Record<string, unknown>) => hashOf({ ...k, version: 0, written_at: "", frozen_at: "", content_hash: "" });
  const kLast = contracts.at(-1);
  const contract = kLast && strip(kLast) === strip(kBody) ? kLast : sealContract({ ...kBody, version: (kLast?.version ?? 0) + 1, written_at: now, frozen_at: now });
  if (contract !== kLast) { writePublic(`data/contracts/${c.claim_id}/${contract.version}.yaml`, ResolutionContract, contract); s.contracts.set(c.claim_id, [...contracts, contract]); }
  const mine = [...s.packets.values()].filter((p) => p.claim_revision_ref.id === c.claim_id);
  let packet = mine.find((p) => p.contract_ref.content_hash === contract.content_hash && !p.evidence_items.length);
  if (!packet) {
    packet = sealPacket({ packet_id: `${c.claim_id}-p${mine.length + 1}`, claim_revision_ref: claimRef(c), contract_ref: contractRef(contract), evaluation_as_of: evaluationDateFor(s, c.claim_id, s.occurrences.get(c.occurrence_ids[0])!.document_id, s.occurrences.get(c.occurrence_ids[0])!.statement_date),
      search_record: { queries: [], sources_considered: [], performed_at: now }, evidence_items: [], material_counterevidence: [], unresolved_gaps: [] });
    writePublic(`data/evidence/${packet.packet_id}.json`, EvidencePacket, packet);
    s.packets.set(packet.packet_id, packet);
  }
  const payload = screenPayload(s, c, contract, packet, reasons);
  if (!payload) continue;
  const prior = [...s.assessments.values()].filter((a) => a.claim_revision_ref.id === c.claim_id).sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0];
  if (prior && prior.public_payload_hash === hashOf(payload) && prior.reviewer_run_ids.join() === runs.join() && prior.policy_version === POLICY_VERSION
    && prior.contract_ref.content_hash === contract.content_hash && prior.packet_ref.content_hash === packet.packet_hash && prior.claim_revision_ref.content_hash === c.content_hash) continue;
  let n = 1; while (fs.existsSync(`data/assessments/${c.claim_id}-a${n}.json`)) n++;
  const a = sealAssessment({
    assessment_id: `${c.claim_id}-a${n}`, claim_revision_ref: claimRef(c), contract_ref: contractRef(contract), packet_ref: packetRef(packet),
    axis: "not_applicable", outcome: "not_adjudicable", horizon_state: "not_applicable", evaluation_as_of: packet.evaluation_as_of, target_period: null,
    public_rationale: payload.rationale, evidence_ids: [], counterevidence_ids: [], limitations: [], drafter: EXTRACTOR, reviewer_run_ids: runs, final_text_run_id: null,
    policy_version: POLICY_VERSION, public_payload: payload, supersedes_assessment_id: prior?.assessment_id ?? null, next_review_due_at: null, conclusive_event: null, recorded_at: now,
  });
  writePublic(`data/assessments/${a.assessment_id}.json`, Assessment, a);
  s.assessments.set(a.assessment_id, a);
  wrote++;
}

// Gate every screened-out claim's latest assessment.
const byId = new Map(lines.map((l) => [l.claim_id, l]));
for (const { c } of toRecord) {
  const a = [...s.assessments.values()].filter((x) => x.claim_revision_ref.id === c.claim_id).sort((x, y) => (x.recorded_at < y.recorded_at ? 1 : -1))[0];
  const g = a ? gate(s, a) : null;
  byId.get(c.claim_id)!.gate = g ? (g.result === "published" ? "published" : `held: ${g.reason}: ${g.detail}`) : "no assessment";
}

fs.mkdirSync("research/corpus", { recursive: true });
fs.writeFileSync("research/corpus/screen-results.jsonl", lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
const by = (st: string) => lines.filter((l) => l.status === st).length;
const held = lines.filter((l) => l.status === "screened_out" && l.gate?.startsWith("held")).length;
console.log(`${lines.length} claims: ${by("screened_out")} screened out (${wrote} new assessments, ${held} held by the gate), ${by("grade")} to grade, ${by("fix")} to fix, ${by("split")} still read differently after a fix, ${by("attribution")} attribution doubts, ${by("pending")} not yet screened by both`);
