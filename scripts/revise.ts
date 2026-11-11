// node scripts/revise.ts [--limit N] [--concurrency N] [--batch N]
// One rewrite of the public text, for graded claims held only because of the
// text: both reviews agree with each other but not with the draft, or the
// final-text check found the text says more than the evidence. The verdict is
// the two reviewers'; the drafter (the same provider) rewrites the rationale to
// match it, the provider other than the drafter checks the new text, and a new
// assessment is recorded with the same two bound reviews. At most twice per
// packet, whatever the agreed verdict (docs/adr/0005, made outcome-blind
// after the cross-vendor review of 2026-10-30). research/corpus/revise-log.jsonl
// records every rewrite.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import { HORIZON_STATES, HORIZON_STATES_FOR_AXIS, OUTCOMES, POLICY_VERSION, type Provider } from "../src/policy.ts";
import { BatchFinalOutput, ReviewRun, type Assessment, type BatchReviewOutput, type ReviewOutput } from "../src/schema.ts";
import { loadStore } from "../src/lib/data.ts";
import { hashOf } from "../src/lib/canonical.ts";
import { caseDigest } from "../src/lib/binding.ts";
import { gate } from "../src/lib/gate.ts";
import { composePayload, DRAFTER, frozenCase, prompt, recordAssessment, type Frozen } from "./lib/review.ts";
import { Draft, DRAFT_DIR, readDraft } from "./lib/draft.ts";
import { putPrivateJson } from "./lib/private-store.ts";
import { callClaudeCli, callCodexCli, CLI_MODELS } from "./lib/subscription.ts";
import { writePublic } from "./lib/writer.ts";

const REVISE = { version: "revise-1", file: "research/prompts/revise-1.md" };
const FINAL = { version: "final-text-batch-1", file: "research/prompts/final-text-batch-1.md" };
const LOG = "research/corpus/revise-log.jsonl";
const sha = (x: string) => createHash("sha256").update(x).digest("hex");
const Revised = z.object({ cases: z.array(z.object({
  claim_id: z.string(), outcome: z.enum(OUTCOMES), horizon_state: z.enum(HORIZON_STATES), rationale: z.string(), limitations: z.array(z.string()),
  what_would_resolve: z.string().nullable(), conclusive_event: z.object({ evidence_id: z.string(), event_date: z.string(), meets_rule: z.string() }).strict().nullable(),
}).strict()) }).strict();

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const limit = Number(opt("--limit") ?? Infinity);
const concurrency = Number(opt("--concurrency") ?? 4);
const batchSize = Number(opt("--batch") ?? 4);

const s = loadStore("data");
const rewrites = new Map<string, number>();
for (const l of fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean) : []) { const k = JSON.parse(l).packet; rewrites.set(k, (rewrites.get(k) ?? 0) + 1); }
const latest = new Map<string, Assessment>();
for (const a of s.assessments.values()) { const p = latest.get(a.claim_revision_ref.id); if (!p || p.recorded_at < a.recorded_at) latest.set(a.claim_revision_ref.id, a); }

type Item = { id: string; a: Assessment; A: ReviewOutput; B: ReviewOutput; notes: string; drafter: Provider };
const entry = (r: ReviewRun | undefined, id: string) => (r?.status === "ok" && r.kind === "batch_review" ? (r.output as BatchReviewOutput).reviews.filter((x) => x.claim_id === id) : []);
const items: Item[] = [];
const cannotRewrite: string[] = [];
for (const [id, a] of latest) {
  const before = rewrites.get(a.packet_ref.content_hash) ?? 0;
  if (before >= 2 || !fs.existsSync(path.join(DRAFT_DIR, `${id}.yaml`))) continue;
  const g = gate(s, a);
  if (g.result !== "held") continue;
  const reviewsAgreeNotDraft = g.reason === "assessment_disagreement" && g.detail.startsWith("Both reviews say");
  const textFailed = g.reason === "semantic_disagreement" && g.detail.startsWith("The final-text check failed");
  if (!reviewsAgreeNotDraft && !textFailed) continue;
  const [ea, eb] = a.reviewer_run_ids.map((r) => entry(s.reviews.get(r), id));
  if (ea.length !== 1 || eb.length !== 1) continue;
  const [A, B] = [ea[0], eb[0]];
  if (A.outcome !== B.outcome || A.axis !== B.axis || A.horizon_state !== B.horizon_state || A.abstain || B.abstain) continue;
  const d = readDraft(id);
  // A rewrite changes the wording, never the frozen test. When the reviewers
  // agree on a different kind of test (axis), or on a deadline state the frozen
  // test cannot take, no rewrite can produce a valid record. Skip it, so the
  // loop stops spending a model call on it every pass. It stays held.
  const axis = d.contract.assessment_axis;
  if (A.axis !== axis || !HORIZON_STATES_FOR_AXIS[axis].includes(A.horizon_state)) { cannotRewrite.push(`${id} (reviewers: ${A.axis}/${A.horizon_state}; frozen test: ${axis})`); continue; }
  items.push({ id, a, A, B, notes: textFailed ? g.detail : "", drafter: d.drafter?.provider ?? DRAFTER.provider });
}
// Batches of one drafter's claims from one post.
const groups = new Map<string, Item[]>();
for (const it of items) { const k = `${it.drafter}|${it.id.replace(/-[0-9a-f]{6}(-\d+)?$/, "")}`; groups.set(k, [...(groups.get(k) ?? []), it]); }
const batches: Item[][] = [];
for (const g of groups.values()) for (let i = 0; i < g.length; i += batchSize) batches.push(g.slice(i, i + batchSize));
const todo = batches.slice(0, limit);
// --limit 0 is a count only: the morning email reads this line (scripts/digest.ts).
if (limit === 0) console.log(`pending: ${batches.reduce((n, b) => n + b.length, 0)} claims in ${batches.length} batches`);
if (cannotRewrite.length) console.log(`${cannotRewrite.length} held claims need a new test, not a rewrite, and are skipped: ${cannotRewrite.join(", ")}`);
console.log(`${todo.reduce((n, b) => n + b.length, 0)} claims in ${todo.length} batches to rewrite (${items.length} eligible)`);

const call = (p: Provider, req: Parameters<typeof callClaudeCli>[0]) => (p === "anthropic" ? callClaudeCli(req) : callCodexCli(req));
const nextId = (prefix: string) => { let n = 1; while (fs.existsSync(`data/reviews/${prefix}-${n}.json`)) n++; return `${prefix}-${n}`; };
let n = 0;
async function one(b: Item[]) {
  const drafter = b[0].drafter;
  const cases = new Map<string, Frozen>(b.map((it) => [it.id, frozenCase(it.id, s)]));
  const body = b.map((it) => {
    const d = readDraft(it.id);
    return `=== CASE ${it.id} ===\n${cases.get(it.id)!.text}\n\nAGREED ASSESSMENT (both reviews): axis ${it.A.axis}, horizon ${it.A.horizon_state}, outcome ${it.A.outcome}\nREVIEW RATIONALES: ${JSON.stringify([it.A.rationale, it.B.rationale])}\n${it.notes ? `FINAL CHECK: ${it.notes}\n` : ""}YOUR CURRENT TEXT: ${JSON.stringify(d.proposal)}`;
  }).join("\n\n");
  const r = await call(drafter, { system: prompt(REVISE), user: body, schema: Revised, schemaName: "revise", effort: "high", timeoutMs: 1_800_000 });
  if (!r.ok) { console.log(`${b[0].id}: ${r.status}: ${r.error.slice(0, 120)}`); return; }
  const ready: { it: Item; f: Frozen; payload: ReturnType<typeof composePayload> }[] = [];
  for (const it of b) {
    const x = r.output.cases.find((c) => c.claim_id === it.id);
    if (!x) continue;
    const file = path.join(DRAFT_DIR, `${it.id}.yaml`);
    const d = readDraft(it.id);
    // The verdict is the reviewers', whatever the rewrite says.
    const proposal = { ...d.proposal, outcome: it.A.outcome, horizon_state: it.A.horizon_state, rationale: x.rationale.slice(0, 1600), limitations: x.limitations.map((l) => l.slice(0, 400)), what_would_resolve: x.what_would_resolve?.slice(0, 600) ?? null, conclusive_event: x.conclusive_event && { ...x.conclusive_event, meets_rule: x.conclusive_event.meets_rule.slice(0, 400) } };
    const next = Draft.safeParse({ ...d, proposal });
    if (!next.success) { console.log(`${it.id}: invalid rewrite: ${next.error.issues[0].message}`); continue; }
    const backup = file.replace(/\.yaml$/, `.before-${it.a.assessment_id}.yaml`);
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, YAML.stringify(next.data, { lineWidth: 0 }), { mode: 0o600 });
    const f = cases.get(it.id)!;
    ready.push({ it, f, payload: composePayload(it.id, f, s) });
  }
  if (!ready.length) return;
  const checker: Provider = drafter === "anthropic" ? "openai" : "anthropic";
  const fph = sha(prompt(FINAL));
  const inputs: Record<string, string> = { prompt: fph };
  for (const x of ready) { inputs[`case:${x.it.id}`] = caseDigest(s, x.f.claim, x.f.contract, x.f.packet, POLICY_VERSION, fph); inputs[`payload:${x.it.id}`] = hashOf(x.payload); }
  const fbody = ready.map((x) => `=== CASE ${x.it.id} ===\n${x.f.text}\n\nAGREED ASSESSMENT (from two independent reviews): axis ${x.it.A.axis}, horizon ${x.it.A.horizon_state}, outcome ${x.it.A.outcome}\n\nPUBLIC PAYLOAD (exactly as it would be published)\n${JSON.stringify(x.payload, null, 1)}`).join("\n\n");
  const rf = await call(checker, { system: prompt(FINAL), user: fbody, schema: BatchFinalOutput, schemaName: "batch_final_text", effort: "high", timeoutMs: 1_800_000 });
  // An outage at the final check is not a result: put each draft back as it
  // was, so the next run starts the rewrite again and no rewrite goes unrecorded.
  if (!rf.ok && rf.status === "unavailable") {
    for (const x of ready) { const file = path.join(DRAFT_DIR, `${x.it.id}.yaml`); fs.copyFileSync(file.replace(/\.yaml$/, `.before-${x.it.a.assessment_id}.yaml`), file); }
    return;
  }
  const id = nextId(`${ready[0].it.id}-${ready.length}x-final-${checker}`);
  putPrivateJson("raw", id, { result: rf.ok ? "ok" : rf.status, raw: rf.raw });
  const run = writePublic(`data/reviews/${id}.json`, ReviewRun, {
    run_id: id, kind: "batch_final_text", provider: checker, model_requested: CLI_MODELS[checker], model_returned: rf.model ?? null, via: "cli-login", prompt_version: FINAL.version, prompt_hash: fph,
    rubric_version: `policy-${POLICY_VERSION}`, input_hashes: inputs, started_at: rf.startedAt, completed_at: rf.completedAt, status: rf.ok ? "ok" : rf.status, output: rf.ok ? rf.output : null,
    error: rf.ok ? null : rf.error, usage: rf.usage, cost_usd: null,
  });
  s.reviews.set(run.run_id, run);
  const results: string[] = [];
  for (const x of ready) {
    const a = recordAssessment(x.it.id, x.f, x.payload, x.it.a.reviewer_run_ids, run.run_id, s);
    s.assessments.set(a.assessment_id, a);
    const g = gate(s, a);
    results.push(g.result === "published" ? a.outcome : `held:${g.reason}`);
    fs.appendFileSync(LOG, JSON.stringify({ claim_id: x.it.id, packet: x.it.a.packet_ref.content_hash, before: x.it.a.assessment_id, after: a.assessment_id, gate: g.result, reason: g.reason }) + "\n");
  }
  n++;
  console.log(`${ready[0].it.id.replace(/-[0-9a-f]{6}(-\d+)?$/, "")} [${ready.length}, ${drafter}]: ${results.join(", ")} (${n}/${todo.length})`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { for (let b = queue.shift(); b; b = queue.shift()) await one(b).catch((e) => console.log(`${b[0].id}: ERROR ${(e as Error).message}`)); }));
console.log(`done: ${n} batches`);
