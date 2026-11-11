// node scripts/review-batch.ts [--limit N] [--concurrency N] [--batch N] [--only <claim-id,...>]
// Reviews every drafted, ingested claim that has no assessment for its current
// evidence packet (policy .7), several claims from one post per call on the
// owner's subscriptions. Each provider reviews each frozen case on its own and
// returns one answer per claim; each answer is bound to that claim's case
// digest. Claims both reviews agree on get their composed public text checked
// by the provider other than the drafter's, again one answer per claim. Every
// claim then gets a sealed assessment, and the gate decides. Writes
// research/corpus/review-log.jsonl.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { POLICY_VERSION, type Provider } from "../src/policy.ts";
import { BatchFinalOutput, BatchReviewOutput, ReviewRun, type Assessment, type EvidencePacket, type ReviewOutput } from "../src/schema.ts";
import { loadStore, type Store } from "../src/lib/data.ts";
import { hashOf } from "../src/lib/canonical.ts";
import { caseDigest } from "../src/lib/binding.ts";
import { gate } from "../src/lib/gate.ts";
import { isScreenContract } from "../src/lib/screen.ts";
import { composePayload, DRAFTER, frozenCase, prompt, recordAssessment, type Frozen } from "./lib/review.ts";
import { DRAFT_DIR, readDraft } from "./lib/draft.ts";
import { putPrivateJson } from "./lib/private-store.ts";
import { callClaudeCli, callCodexCli, CLI_MODELS } from "./lib/subscription.ts";
import { writePublic } from "./lib/writer.ts";

const REVIEW = { version: "review-batch-1", file: "research/prompts/review-batch-1.md" };
const FINAL = { version: "final-text-batch-1", file: "research/prompts/final-text-batch-1.md" };
const sha = (x: string) => createHash("sha256").update(x).digest("hex");

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const limit = Number(opt("--limit") ?? Infinity);
const concurrency = Number(opt("--concurrency") ?? 3);
const batchSize = Number(opt("--batch") ?? 4);
const only = opt("--only")?.split(",");

// Same agreement the gate requires.
const agree = (A: ReviewOutput, B: ReviewOutput, drafted: string) =>
  !A.abstain && !B.abstain && A.outcome === B.outcome && A.outcome === drafted && (A.outcome === "not_adjudicable" || (A.axis === B.axis && A.horizon_state === B.horizon_state));

function pending(s: Store): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const byPacket = new Map<string, Assessment[]>();
  for (const a of s.assessments.values()) byPacket.set(a.packet_ref.content_hash, [...(byPacket.get(a.packet_ref.content_hash) ?? []), a]);
  // A packet is done when an assessment for it published, or was held for a
  // reason a rerun cannot change. An outage, a malformed answer, or a missing
  // final check is retried, at most twice per packet.
  const RETRY = new Set(["verification_unavailable", "budget_exhausted", "malformed_review"]);
  const done = (h: string) => { const as = byPacket.get(h) ?? []; return as.length >= 3 || as.some((a) => { const g = gate(s, a); return g.result === "published" || !RETRY.has(g.reason); }); };
  const packetsOf = new Map<string, EvidencePacket[]>();
  for (const p of s.packets.values()) packetsOf.set(p.claim_revision_ref.id, [...(packetsOf.get(p.claim_revision_ref.id) ?? []), p]);
  for (const [id, revs] of s.claims) {
    if (only && !only.includes(id)) continue;
    const c = revs.at(-1)!, k = s.contracts.get(id)?.at(-1);
    if (!k || isScreenContract(k) || k.claim_revision_ref.content_hash !== c.content_hash || !fs.existsSync(`${DRAFT_DIR}/${id}.yaml`)) continue;
    const p = (packetsOf.get(id) ?? []).filter((x) => x.contract_ref.content_hash === k.content_hash).sort((a, b) => (a.packet_id < b.packet_id ? 1 : -1))[0];
    if (!p || done(p.packet_hash)) continue;
    const o = s.occurrences.get(c.occurrence_ids[0]);
    if (!o?.extraction_run.startsWith("extract-")) continue;
    if (!out.has(o.document_id)) out.set(o.document_id, []);
    out.get(o.document_id)!.push(id);
  }
  return out;
}

let s = loadStore("data");
const rph = sha(prompt(REVIEW));
// A good review is never thrown away. When a claim is retried because one
// provider failed, the other provider's answer is reused if it is still bound
// to the same case and prompt, and only the failed provider is asked again.
const runsByClaim = new Map<string, ReviewRun[]>();
for (const r of s.reviews.values()) {
  if (r.kind !== "batch_review" || r.status !== "ok" || r.prompt_hash !== rph) continue;
  for (const k of Object.keys(r.input_hashes)) if (k.startsWith("case:")) { const id = k.slice(5); runsByClaim.set(id, [...(runsByClaim.get(id) ?? []), r]); }
}
const reuse = new Map<string, Partial<Record<Provider, ReviewRun>>>();
const pend = pending(s);
for (const ids of pend.values()) for (const id of ids) {
  const prior = runsByClaim.get(id);
  if (!prior) continue;
  const f = frozenCase(id, s);
  const dig = caseDigest(s, f.claim, f.contract, f.packet, POLICY_VERSION, rph);
  const got: Partial<Record<Provider, ReviewRun>> = {};
  for (const r of prior) {
    if (r.input_hashes[`case:${id}`] !== dig || (r.output as BatchReviewOutput).reviews.filter((x) => x.claim_id === id).length !== 1) continue;
    const had = got[r.provider];
    if (!had || had.completed_at < r.completed_at) got[r.provider] = r;
  }
  if (Object.keys(got).length) reuse.set(id, got);
}
// Batches of one post's claims that need the same providers asked.
const batches: string[][] = [];
for (const ids of pend.values()) {
  const groups = new Map<string, string[]>();
  for (const id of ids) { const r = reuse.get(id) ?? {}; const k = `${!r.anthropic}|${!r.openai}`; groups.set(k, [...(groups.get(k) ?? []), id]); }
  for (const g of groups.values()) for (let i = 0; i < g.length; i += batchSize) batches.push(g.slice(i, i + batchSize));
}
const todo = batches.slice(0, limit);
// --limit 0 is a count only: the morning email reads this line (scripts/digest.ts).
if (limit === 0) console.log(`pending: ${batches.reduce((n, b) => n + b.length, 0)} claims in ${batches.length} batches`);
console.log(`${todo.reduce((n, b) => n + b.length, 0)} claims in ${todo.length} batches to review (${batches.length} pending, ${reuse.size} reusing a good review)`);
const nextId = (prefix: string) => { let n = 1; while (fs.existsSync(`data/reviews/${prefix}-${n}.json`)) n++; return `${prefix}-${n}`; };

function record(kind: "batch_review" | "batch_final_text", provider: Provider, p: { version: string; file: string }, inputs: Record<string, string>, r: Awaited<ReturnType<typeof callClaudeCli>>, prefix: string): ReviewRun {
  const id = nextId(prefix);
  putPrivateJson("raw", id, { result: r.ok ? "ok" : r.status, raw: r.raw });
  const run = writePublic(`data/reviews/${id}.json`, ReviewRun, {
    run_id: id, kind, provider, model_requested: CLI_MODELS[provider], model_returned: r.model ?? null, via: "cli-login", prompt_version: p.version, prompt_hash: sha(prompt(p)),
    rubric_version: `policy-${POLICY_VERSION}`, input_hashes: inputs, started_at: r.startedAt, completed_at: r.completedAt, status: r.ok ? "ok" : r.status,
    output: r.ok ? r.output : null, error: r.ok ? null : r.error, usage: r.usage, cost_usd: null,
  });
  s.reviews.set(run.run_id, run);
  return run;
}
const call = (provider: Provider, req: Parameters<typeof callClaudeCli>[0]) => (provider === "anthropic" ? callClaudeCli(req) : callCodexCli(req));

let done = 0;
const log: string[] = [];
async function one(ids: string[]) {
  const cases = new Map<string, Frozen>(ids.map((id) => [id, frozenCase(id, s)]));
  const inputs: Record<string, string> = { prompt: rph };
  for (const [id, f] of cases) inputs[`case:${id}`] = caseDigest(s, f.claim, f.contract, f.packet, POLICY_VERSION, rph);
  const body = [...cases].map(([id, f]) => `=== CASE ${id} ===\n${f.text}\n\nList every evidence item id of this case in its evidence array, in the same order.`).join("\n\n");
  const prefix = `${ids[0]}-${ids.length}x`;
  // Every claim in a batch needs the same providers asked (see the grouping above).
  const ask = (["anthropic", "openai"] as Provider[]).filter((p) => !reuse.get(ids[0])?.[p]);
  const answers = await Promise.all(ask.map((p) => call(p, { system: prompt(REVIEW), user: body, schema: BatchReviewOutput, schemaName: "batch_review", effort: "high", timeoutMs: 2_400_000 })));
  // A usage limit is not a review: record nothing and leave the claims pending.
  if (answers.some((r) => !r.ok && r.status === "unavailable")) { console.log(`${ids[0]}: skipped: usage limit`); return; }
  const fresh = new Map<Provider, ReviewRun>(ask.map((p, i) => [p, record("batch_review", p, REVIEW, inputs, answers[i], `${prefix}-review-${p}`)]));
  const runsFor = (id: string) => (["anthropic", "openai"] as Provider[]).map((p) => fresh.get(p) ?? reuse.get(id)![p]!);
  const entry = (r: ReviewRun, id: string) => (r.status === "ok" ? (r.output as BatchReviewOutput).reviews.filter((x) => x.claim_id === id) : []);
  const agreed: { id: string; f: Frozen; payload: ReturnType<typeof composePayload>; A: ReviewOutput }[] = [];
  for (const [id, f] of cases) {
    const [ea, eo] = runsFor(id).map((r) => entry(r, id));
    const payload = composePayload(id, f, s);
    if (ea.length === 1 && eo.length === 1 && agree(ea[0], eo[0], payload.outcome)) agreed.push({ id, f, payload, A: ea[0] });
  }
  // The final text is checked by the provider other than each claim's drafter.
  const finals = new Map<string, ReviewRun>();
  for (const checker of ["openai", "anthropic"] as Provider[]) {
    const mine = agreed.filter((x) => (readDraft(x.id).drafter?.provider ?? DRAFTER.provider) !== checker);
    if (!mine.length) continue;
    const fph = sha(prompt(FINAL));
    const finputs: Record<string, string> = { prompt: fph };
    for (const x of mine) { finputs[`case:${x.id}`] = caseDigest(s, x.f.claim, x.f.contract, x.f.packet, POLICY_VERSION, fph); finputs[`payload:${x.id}`] = hashOf(x.payload); }
    const fbody = mine.map((x) => {
      const ag = x.A.outcome === "not_adjudicable" ? { axis: x.payload.axis, horizon_state: x.payload.horizon_state, outcome: x.A.outcome } : x.A;
      return `=== CASE ${x.id} ===\n${x.f.text}\n\nAGREED ASSESSMENT (from two independent reviews): axis ${ag.axis}, horizon ${ag.horizon_state}, outcome ${ag.outcome}\n\nPUBLIC PAYLOAD (exactly as it would be published)\n${JSON.stringify(x.payload, null, 1)}`;
    }).join("\n\n");
    const rf = await call(checker, { system: prompt(FINAL), user: fbody, schema: BatchFinalOutput, schemaName: "batch_final_text", effort: "high", timeoutMs: 2_400_000 });
    const run = record("batch_final_text", checker, FINAL, finputs, rf, `${prefix}-final-${checker}`);
    for (const x of mine) finals.set(x.id, run);
  }
  const results: string[] = [];
  for (const [id, f] of cases) {
    const payload = agreed.find((x) => x.id === id)?.payload ?? composePayload(id, f, s);
    const runs = runsFor(id);
    const a: Assessment = recordAssessment(id, f, payload, runs.map((r) => r.run_id), finals.get(id)?.run_id ?? null, s);
    s.assessments.set(a.assessment_id, a);
    const g = gate(s, a);
    results.push(g.result === "published" ? a.outcome : `held:${g.reason}`);
    log.push(JSON.stringify({ claim_id: id, assessment: a.assessment_id, drafted: payload.outcome, reviews: runs.map((r) => entry(r, id)[0]?.outcome ?? r.status), gate: g.result, reason: g.reason, detail: g.result === "held" ? g.detail.slice(0, 300) : null }));
  }
  done++;
  console.log(`${ids[0].replace(/-[0-9a-f]{6}(-\d+)?$/, "")} [${ids.length}${ask.length < 2 ? `, asked ${ask.join(" ") || "none"}` : ""}]: ${results.join(", ")} (${done}/${todo.length})`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { for (let b = queue.shift(); b; b = queue.shift()) await one(b).catch((e) => console.log(`${b[0]}: ERROR ${(e as Error).stack?.slice(0, 400)}`)); }));
if (log.length) fs.appendFileSync("research/corpus/review-log.jsonl", log.join("\n") + "\n");
console.log(`done: ${done} batches`);
