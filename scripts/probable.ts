// node scripts/probable.ts [--limit N] [--concurrency N] [--batch N] [--only <claim-id,...>]
// Probable calls (docs/adr/0006). Both providers answer the looser question,
// "would a reasonable reader call this claim today?", for every claim the
// strict review left unresolved, or held without doubting its words. A few
// claims from one post go to each call, on the owner's subscriptions, with no
// web search: they judge the evidence packet already frozen for the case. Each
// answer is a public review run bound to its case. Code combines the two
// answers when a release is built (src/lib/probable.ts). Resumable: a provider
// that already answered a case as it stands is not asked again.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { loadStore } from "../src/lib/data.ts";
import { gate } from "../src/lib/gate.ts";
import { caseDigest } from "../src/lib/binding.ts";
import { probableEligible, probableIndex } from "../src/lib/probable.ts";
import { POLICY_VERSION, type Provider } from "../src/policy.ts";
import { BatchProbableOutput, ReviewRun, type Assessment } from "../src/schema.ts";
import { frozenCase, prompt, type Frozen } from "./lib/review.ts";
import { putPrivateJson } from "./lib/private-store.ts";
import { callClaudeCli, callCodexCli, CLI_MODELS } from "./lib/subscription.ts";
import { writePublic } from "./lib/writer.ts";

const PROBABLE = { version: "probable-1", file: "research/prompts/probable-1.md" };
const LOG = "research/corpus/probable-log.jsonl";
const sha = (x: string) => createHash("sha256").update(x).digest("hex");
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const limit = Number(opt("--limit") ?? Infinity);
const concurrency = Number(opt("--concurrency") ?? 4);
const batchSize = Number(opt("--batch") ?? 6);
const only = opt("--only")?.split(",");

const s = loadStore("data");
const ph = sha(prompt(PROBABLE));
const index = probableIndex(s);
const latest = new Map<string, Assessment>();
for (const a of s.assessments.values()) { const p = latest.get(a.claim_revision_ref.id); if (!p || p.recorded_at < a.recorded_at) latest.set(a.claim_revision_ref.id, a); }

type Item = { id: string; f: Frozen; digest: string; ask: Provider[] };
const groups = new Map<string, Item[]>();
let eligible = 0;
for (const [id, a] of latest) {
  if (only && !only.includes(id)) continue;
  if (!probableEligible(s, a, gate(s, a))) continue;
  let f: Frozen;
  try { f = frozenCase(id, s); } catch { continue; }
  // A newer contract or packet is waiting for its strict review: ask after it.
  if (f.contract.content_hash !== a.contract_ref.content_hash || f.packet.packet_hash !== a.packet_ref.content_hash) continue;
  eligible++;
  const digest = caseDigest(s, f.claim, f.contract, f.packet, POLICY_VERSION, ph);
  // Answered only when a bound run holds exactly one answer for this claim.
  const answered = new Set((index.get(id) ?? []).filter((r) => r.prompt_hash === ph && r.input_hashes[`case:${id}`] === digest && (r.output as BatchProbableOutput).calls.filter((c) => c.claim_id === id).length === 1).map((r) => r.provider));
  const ask = (["anthropic", "openai"] as Provider[]).filter((p) => !answered.has(p));
  if (!ask.length) continue;
  const key = `${s.occurrences.get(f.claim.occurrence_ids[0])!.document_id}|${ask.join(",")}`;
  groups.set(key, [...(groups.get(key) ?? []), { id, f, digest, ask }]);
}
const batches: Item[][] = [];
for (const g of groups.values()) for (let i = 0; i < g.length; i += batchSize) batches.push(g.slice(i, i + batchSize));
const todo = batches.slice(0, limit);
// --limit 0 is a count only: the morning email reads this line (scripts/digest.ts).
if (limit === 0) console.log(`pending: ${batches.reduce((n, b) => n + b.length, 0)} claims in ${batches.length} batches`);
console.log(`${todo.reduce((n, b) => n + b.length, 0)} claims in ${todo.length} batches to call (${batches.length} pending, ${eligible} eligible)`);

const call = (p: Provider, req: Parameters<typeof callClaudeCli>[0]) => (p === "anthropic" ? callClaudeCli(req) : callCodexCli(req));
const nextId = (prefix: string) => { let n = 1; while (fs.existsSync(`data/reviews/${prefix}-${n}.json`)) n++; return `${prefix}-${n}`; };
let done = 0;
async function one(b: Item[]) {
  const body = b.map((it) => `=== CASE ${it.id} ===\n${it.f.text}`).join("\n\n");
  const inputs: Record<string, string> = { prompt: ph };
  for (const it of b) inputs[`case:${it.id}`] = it.digest;
  const results: string[] = [];
  await Promise.all(b[0].ask.map(async (p) => {
    const r = await call(p, { system: prompt(PROBABLE), user: body, schema: BatchProbableOutput, schemaName: "batch_probable", effort: "medium", timeoutMs: 1_800_000 });
    // A usage limit is not an answer: record nothing and leave the cases pending.
    if (!r.ok && r.status === "unavailable") { results.push(`${p}: usage limit`); return; }
    const id = nextId(`${b[0].id}-${b.length}x-probable-${p}`);
    putPrivateJson("raw", id, { result: r.ok ? "ok" : r.status, raw: r.raw });
    writePublic(`data/reviews/${id}.json`, ReviewRun, {
      run_id: id, kind: "batch_probable", provider: p, model_requested: CLI_MODELS[p], model_returned: r.model ?? null, via: "cli-login", prompt_version: PROBABLE.version, prompt_hash: ph,
      rubric_version: `policy-${POLICY_VERSION}`, input_hashes: inputs, started_at: r.startedAt, completed_at: r.completedAt, status: r.ok ? "ok" : r.status, output: r.ok ? r.output : null,
      error: r.ok ? null : r.error, usage: r.usage, cost_usd: null,
    });
    const calls = r.ok ? r.output.calls : [];
    results.push(`${p}: ${r.ok ? b.map((it) => calls.find((c) => c.claim_id === it.id)?.call ?? "missing").join(", ") : r.status}`);
    fs.appendFileSync(LOG, b.map((it) => JSON.stringify({ claim_id: it.id, at: r.completedAt, provider: p, run: id, result: r.ok ? (calls.find((c) => c.claim_id === it.id)?.call ?? "missing") : r.status })).join("\n") + "\n");
  }));
  done++;
  console.log(`${b[0].id} [${b.length}]: ${results.join("; ")} (${done}/${todo.length})`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) { const b = queue.shift()!; await one(b).catch((e) => console.log(`${b[0].id}: ERROR ${(e as Error).message}`)); } }));
console.log(`done: ${done} batches`);
