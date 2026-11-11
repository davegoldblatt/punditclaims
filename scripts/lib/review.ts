// Reviews for one claim: two independent providers review the same frozen
// case, then the drafter's composed public text is checked by a provider other
// than the drafter's. Neither reviewer sees the other's answer or the drafter's
// proposal. Public records keep the structured, bounded answers; the raw
// responses (which can quote source text) stay private.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { loadStore, type Store } from "../../src/lib/data.ts";
import { hashOf } from "../../src/lib/canonical.ts";
import { caseDigest } from "../../src/lib/binding.ts";
import { claimRef, contractRef, packetRef, sealAssessment } from "../../src/lib/records.ts";
import { Assessment, FinalTextOutput, ReviewOutput, ReviewRun, type ClaimRevision, type EvidencePacket, type PublicPayload, type ResolutionContract } from "../../src/schema.ts";
import { POLICY_VERSION, type Provider } from "../../src/policy.ts";
import { privateKey, readDraft } from "./draft.ts";
import { getPrivateJson, putPrivateJson } from "./private-store.ts";
import { Budget, call, MODELS, type CallResult, type Route } from "./vendors.ts";
import { CLI_MODELS } from "./subscription.ts";
import { writePublic } from "./writer.ts";
import { CONFIG, SUBJECT_NAMES } from "../../src/config.ts";
import { nowStamp } from "./capture.ts";

export const DRAFTER = { provider: "anthropic" as const, model: "claude-opus-5-5" };
export const REVIEW_PROMPT = { version: "review-5", file: "research/prompts/review-5.md" };
export const FINAL_PROMPT = { version: "final-text-1", file: "research/prompts/final-text-1.md" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// Prompts are templates: the deployment's site name, topic, and people come
// from config/register.yaml, so the same prompts serve any register. The hash
// recorded with each review is of the rendered text the model received.
export const prompt = (p: { file: string }) => fs.readFileSync(p.file, "utf8").replace(/\{\{site\}\}/g, CONFIG.site.name).replace(/\{\{topic\}\}/g, CONFIG.site.topic).replace(/\{\{subjects\}\}/g, SUBJECT_NAMES);

export type Frozen = { claim: ClaimRevision; contract: ResolutionContract; packet: EvidencePacket; text: string; documents: Map<string, { title: string; url: string; date: string | null; observed_at: string }> };

const untrusted = (label: string, body: string) => `<<<UNTRUSTED SOURCE TEXT: ${label}>>>\n${body.replace(/<<<|>>>/g, "« »")}\n<<<END UNTRUSTED SOURCE TEXT>>>`;

// The frozen case, rendered the same way for every reviewer.
export function frozenCase(claimId: string, store?: Store): Frozen {
  const s = store ?? loadStore("data");
  const claim = s.claims.get(claimId)?.at(-1);
  const contract = s.contracts.get(claimId)?.at(-1);
  const packet = [...s.packets.values()].filter((p) => p.claim_revision_ref.id === claimId).sort((a, b) => (a.packet_id < b.packet_id ? 1 : -1))[0];
  if (!claim || !contract || !packet) throw new Error(`${claimId}: no claim, contract, or packet; ingest the draft first`);
  const documents = new Map<string, { title: string; url: string; date: string | null; observed_at: string }>();
  const parts: string[] = [];
  parts.push(`EVALUATION DATE: ${packet.evaluation_as_of}`);
  parts.push(`SUBJECT: ${claim.subject_id}`);
  for (const oid of claim.occurrence_ids) {
    const o = s.occurrences.get(oid)!;
    const d = s.documents.get(o.document_id)!;
    const v = s.versions.get(o.source_version_receipts[0].source_snapshot_id)!;
    documents.set(d.document_id, { title: d.title, url: d.canonical_url, date: d.original_published_at, observed_at: v.first_observed_at });
    const q = getPrivateJson<{ quote: string; context: string }>("quotes", privateKey(oid, o.source_version_receipts[0].quote_hash)) ?? getPrivateJson<{ quote: string; context: string }>("quotes", oid);
    if (!q) throw new Error(`${oid}: the private quotation is missing; re-ingest`);
    parts.push(`STATEMENT ${oid}\nSource: "${d.title}" (${d.publisher}), ${d.canonical_url}\nPublished: ${d.original_published_at ?? "unknown"}; this version observed ${v.first_observed_at}; access ${v.access_state}\nAttributed to: ${o.attributed_speaker} (${o.endorsement_status})\nExact words: ${JSON.stringify(q.quote)}\nPublic excerpt: ${JSON.stringify(o.source_version_receipts[0].public_excerpt)}\n${untrusted(`context around ${oid}`, q.context)}`);
  }
  const { content_hash: _c, created_at: _t, ...claimView } = claim;
  parts.push(`CLAIM (as normalised by the drafter)\n${JSON.stringify(claimView, null, 1)}`);
  const { content_hash: _k, claim_revision_ref: _r, ...contractView } = contract;
  parts.push(`RESOLUTION CONTRACT (frozen ${contract.frozen_at})\n${JSON.stringify(contractView, null, 1)}`);
  parts.push(`EVIDENCE PACKET ${packet.packet_id}\nQueries run: ${JSON.stringify(packet.search_record.queries)}\nSources considered: ${JSON.stringify(packet.search_record.sources_considered)}\nStated gaps: ${JSON.stringify(packet.unresolved_gaps)}\nMaterial counterevidence: ${JSON.stringify(packet.material_counterevidence)}`);
  for (const i of packet.evidence_items) {
    const e = getPrivateJson<{ quote: string; context: string }>("evidence", privateKey(`${claimId}-${i.id}`, i.receipt.quote_hash)) ?? getPrivateJson<{ quote: string; context: string }>("evidence", `${claimId}-${i.id}`);
    if (!e) throw new Error(`${i.id}: the private evidence text is missing; re-ingest`);
    const d = s.documents.get(i.document_id)!;
    documents.set(d.document_id, { title: d.title, url: d.canonical_url, date: d.original_published_at, observed_at: i.retrieved_at });
    const { receipt: _x, ...meta } = i;
    parts.push(`EVIDENCE ITEM ${i.id}\n${JSON.stringify(meta, null, 1)}\nExact words: ${JSON.stringify(e.quote)}\n${untrusted(`context around ${i.id}`, e.context)}`);
  }
  return { claim, contract, packet, text: parts.join("\n\n"), documents };
}

export let ROUTE: Route = "api";
export const setRoute = (r: Route) => { ROUTE = r; };

function runRecord(id: string, kind: "assessment_review" | "final_text_verification", provider: Provider, p: { version: string; file: string }, inputs: Record<string, string>, r: CallResult<unknown>) {
  putPrivateJson("raw", id, { result: r.ok ? "ok" : r.status, raw: r.raw });
  return writePublic(`data/reviews/${id}.json`, ReviewRun, {
    run_id: id, kind, provider, model_requested: ROUTE === "subscription" ? CLI_MODELS[provider] : MODELS[provider], model_returned: r.model ?? null, via: ROUTE === "subscription" ? "cli-login" : "api",
    prompt_version: p.version, prompt_hash: sha(prompt(p)), rubric_version: `policy-${POLICY_VERSION}`, input_hashes: inputs,
    started_at: r.startedAt, completed_at: r.completedAt, status: r.ok ? "ok" : r.status, output: r.ok ? r.output : null,
    error: r.ok ? null : r.error, usage: r.usage, cost_usd: r.cost_usd,
  });
}

const nextId = (prefix: string) => { let n = 1; while (fs.existsSync(`data/reviews/${prefix}-${n}.json`)) n++; return `${prefix}-${n}`; };

export async function reviewClaim(claimId: string, budget: Budget, log: (s: string) => void = console.log) {
  const f = frozenCase(claimId);
  const ph = sha(prompt(REVIEW_PROMPT));
  const inputs = { claim: f.claim.content_hash, contract: f.contract.content_hash, packet: f.packet.packet_hash, prompt: ph, case: caseDigest(loadStore("data"), f.claim, f.contract, f.packet, POLICY_VERSION, ph) };
  const system = prompt(REVIEW_PROMPT);
  const user = `${f.text}\n\nList every evidence item id above in your evidence array, in the same order.`;
  const [a, b] = await Promise.all((["anthropic", "openai"] as Provider[]).map((p) => call(p, { system, user, schema: ReviewOutput, schemaName: "review" }, budget, ROUTE)));
  const runs = [
    runRecord(nextId(`${claimId}-review-anthropic`), "assessment_review", "anthropic", REVIEW_PROMPT, inputs, a),
    runRecord(nextId(`${claimId}-review-openai`), "assessment_review", "openai", REVIEW_PROMPT, inputs, b),
  ];
  for (const r of runs) log(`  ${r.provider} review ${r.status}${r.status === "ok" && r.output && "outcome" in r.output ? `: ${r.output.axis} / ${r.output.horizon_state} / ${r.output.outcome}${r.output.abstain ? " (abstained)" : ""}` : r.error ? `: ${r.error}` : ""}`);
  return { frozen: f, runs };
}

// The reader-visible case, composed from the frozen records and the drafter's
// wording. Nothing in it is new evidence.
export function composePayload(claimId: string, f: Frozen, store?: Store): PublicPayload {
  const d = readDraft(claimId);
  const s = store ?? loadStore("data");
  const o = s.occurrences.get(f.claim.occurrence_ids[0])!;
  const doc = s.documents.get(o.document_id)!;
  const v = s.versions.get(o.source_version_receipts[0].source_snapshot_id)!;
  return {
    claim_id: claimId, subject_id: f.claim.subject_id, normalized_proposition: f.claim.normalized_proposition, kind: f.claim.kind,
    conditions: f.claim.conditions.map((c) => c.text), original_horizon_text: f.claim.original_horizon_text,
    statement: { excerpt: o.source_version_receipts[0].public_excerpt, locator: o.source_version_receipts[0].excerpt_locator, url: doc.canonical_url, date: o.statement_date, document_title: doc.title, observed_at: v.first_observed_at },
    criteria: { from_speaker: f.contract.explicit_source_elements, our_interpretation: f.contract.evaluator_interpretation, support_condition: f.contract.support_condition, contradiction_condition: f.contract.contradiction_condition },
    axis: f.contract.assessment_axis, outcome: d.proposal.outcome, horizon_state: d.proposal.horizon_state, evaluation_as_of: f.packet.evaluation_as_of,
    rationale: d.proposal.rationale, limitations: d.proposal.limitations,
    evidence: f.packet.evidence_items.map((i) => ({ id: i.id, relation: i.relation, excerpt: i.receipt.public_excerpt, locator: i.locator, url: i.url, publisher: i.publisher, event_date: i.event_date, available_at: i.available_at, explanation: i.explanation })),
    what_would_resolve: d.proposal.what_would_resolve, retrospective: f.contract.retrospective_or_prospective === "retrospective",
    ...(f.contract.plain_reading ? { plain_reading: true } : {}),
  };
}

export async function finalTextCheck(claimId: string, f: Frozen, payload: PublicPayload, agreed: { axis: string; horizon_state: string; outcome: string }, budget: Budget, log: (s: string) => void = console.log) {
  const provider: Provider = DRAFTER.provider === "anthropic" ? "openai" : "anthropic";
  const payloadHash = hashOf(payload);
  const ph = sha(prompt(FINAL_PROMPT));
  const inputs = { claim: f.claim.content_hash, contract: f.contract.content_hash, packet: f.packet.packet_hash, payload: payloadHash, prompt: ph, case: caseDigest(loadStore("data"), f.claim, f.contract, f.packet, POLICY_VERSION, ph) };
  const user = `${f.text}\n\nAGREED ASSESSMENT (from two independent reviews): axis ${agreed.axis}, horizon ${agreed.horizon_state}, outcome ${agreed.outcome}\n\nPUBLIC PAYLOAD (exactly as it would be published)\n${JSON.stringify(payload, null, 1)}`;
  const r = await call(provider, { system: prompt(FINAL_PROMPT), user, schema: FinalTextOutput, schemaName: "final_text" }, budget, ROUTE);
  const run = runRecord(nextId(`${claimId}-final-${provider}`), "final_text_verification", provider, FINAL_PROMPT, inputs, r);
  log(`  ${provider} final-text check ${run.status}${run.status === "ok" && run.output && "verdict" in run.output ? `: ${run.output.verdict}${run.output.overclaims.length ? ` (${run.output.overclaims.length} overclaim(s))` : ""}` : run.error ? `: ${run.error}` : ""}`);
  return run;
}

// The assessment record: sealed, bound to every input by hash. Whether it
// publishes is the gate's decision at release time, not this function's.
export function recordAssessment(claimId: string, f: Frozen, payload: PublicPayload, reviewIds: string[], finalId: string | null, store?: Store) {
  const d = readDraft(claimId);
  const s = store ?? loadStore("data");
  const prior = [...s.assessments.values()].filter((a) => a.claim_revision_ref.id === claimId).sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0];
  let n = 1; while (fs.existsSync(`data/assessments/${claimId}-a${n}.json`)) n++;
  const a = sealAssessment({
    assessment_id: `${claimId}-a${n}`, claim_revision_ref: claimRef(f.claim), contract_ref: contractRef(f.contract), packet_ref: packetRef(f.packet),
    axis: payload.axis, outcome: payload.outcome, horizon_state: payload.horizon_state, evaluation_as_of: payload.evaluation_as_of, target_period: f.contract.target_period,
    public_rationale: payload.rationale, evidence_ids: f.packet.evidence_items.filter((i) => i.relation !== "context" || true).map((i) => i.id), counterevidence_ids: f.packet.material_counterevidence,
    limitations: payload.limitations, drafter: d.drafter ?? DRAFTER, reviewer_run_ids: reviewIds, final_text_run_id: finalId, policy_version: POLICY_VERSION,
    public_payload: payload, supersedes_assessment_id: prior?.assessment_id ?? null, next_review_due_at: null, conclusive_event: d.proposal.conclusive_event, recorded_at: nowStamp(),
  });
  return writePublic(`data/assessments/${a.assessment_id}.json`, Assessment, a);
}
