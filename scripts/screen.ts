// node scripts/screen.ts [--window <id>] [--limit N] [--concurrency N] [--effort low|medium|high]
// The screen (policy .7). For each post, both providers read the full post
// and every claim extracted from it, independently, on the owner's
// subscriptions, and answer per claim: is the record right, and could public
// evidence settle the claim at all? Each answer is a public review record
// (kind "screen") bound to every claim's exact content and statements.
// Resumable: a post is skipped when both providers already have a successful
// screen bound to every one of its current claims.
import { windowEvaluationDate } from "./lib/evaluation.ts";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { CONFIG, subjectName, SUBJECT_NAMES } from "../src/config.ts";
import { POLICY_VERSION, type Provider } from "../src/policy.ts";
import { ReviewRun, ScreenOutput, type ClaimRevision } from "../src/schema.ts";
import { loadStore, type Store } from "../src/lib/data.ts";
import { claimDigest } from "../src/lib/binding.ts";
import { privateKey } from "./lib/draft.ts";
import { getPrivateJson, getSnapshot, putPrivateJson } from "./lib/private-store.ts";
import { callClaudeCli, callCodexCli, CLI_MODELS } from "./lib/subscription.ts";
import { writePublic } from "./lib/writer.ts";

export const SCREEN_PROMPT = { version: "screen-1", file: "research/prompts/screen-1.md" };
export const screenPrompt = () => fs.readFileSync(SCREEN_PROMPT.file, "utf8").replace(/\{\{site\}\}/g, CONFIG.site.name).replace(/\{\{topic\}\}/g, CONFIG.site.topic).replace(/\{\{subjects\}\}/g, SUBJECT_NAMES);
export const screenPromptHash = () => createHash("sha256").update(screenPrompt()).digest("hex");

// The claims extracted from each post, in extraction order.
export function claimsByPost(s: Store): Map<string, ClaimRevision[]> {
  const out = new Map<string, ClaimRevision[]>();
  for (const revs of s.claims.values()) {
    const c = revs.at(-1)!;
    const o = s.occurrences.get(c.occurrence_ids[0]);
    if (!o || !o.extraction_run.startsWith("extract-")) continue;
    if (!out.has(o.document_id)) out.set(o.document_id, []);
    out.get(o.document_id)!.push(c);
  }
  for (const list of out.values()) list.sort((a, b) => s.occurrences.get(a.occurrence_ids[0])!.source_version_receipts[0].source_span.start - s.occurrences.get(b.occurrence_ids[0])!.source_version_receipts[0].source_span.start);
  return out;
}

// The latest successful screen from a provider that is bound to this claim as it stands.
const index = new WeakMap<Store, Map<string, ReviewRun[]>>();
export function currentScreen(s: Store, c: ClaimRevision, provider: Provider, ph: string): ReviewRun | undefined {
  let ix = index.get(s);
  if (!ix) {
    ix = new Map();
    for (const r of s.reviews.values()) {
      if (r.kind !== "screen" || r.status !== "ok") continue;
      for (const k of Object.keys(r.input_hashes)) if (k.startsWith("claim:")) {
        const key = `${r.provider}|${k.slice(6)}`;
        if (!ix.has(key)) ix.set(key, []);
        ix.get(key)!.push(r);
      }
    }
    index.set(s, ix);
  }
  const digest = claimDigest(s, c, POLICY_VERSION, ph);
  return (ix.get(`${provider}|${c.claim_id}`) ?? []).filter((r) => r.input_hashes[`claim:${c.claim_id}`] === digest && (r.output as ScreenOutput).entries.filter((e) => e.claim_id === c.claim_id).length === 1)
    .sort((a, b) => ((a.completed_at ?? "") < (b.completed_at ?? "") ? 1 : -1))[0];
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const onlyWindow = opt("--window");
  const limit = Number(opt("--limit") ?? Infinity);
  const concurrency = Number(opt("--concurrency") ?? 3);
  const effort = (opt("--effort") ?? "medium") as "low" | "medium" | "high";
  const providers: Provider[] = opt("--provider") ? [opt("--provider") as Provider] : ["anthropic", "openai"];

  const system = screenPrompt();
  const ph = screenPromptHash();
  const s = loadStore("data");
  const byPost = claimsByPost(s);
  const windowOf = new Map<string, string>();
  for (const subj of CONFIG.subjects) for (const w of subj.windows) {
    const f = `research/coverage/${w.id}.json`;
    if (fs.existsSync(f)) for (const it of JSON.parse(fs.readFileSync(f, "utf8")).items) windowOf.set(it.document_id, w.id);
  }
  type Job = { docId: string; provider: Provider; claims: ClaimRevision[] };
  const jobs: Job[] = [];
  for (const [docId, claims] of byPost) {
    if (onlyWindow && windowOf.get(docId) !== onlyWindow) continue;
    // Only the claims this provider has not screened as they now stand.
    for (const p of providers) { const need = claims.filter((c) => !currentScreen(s, c, p, ph)); if (need.length) jobs.push({ docId, provider: p, claims: need }); }
  }
  // Interleave providers so both progress together.
  const todo = jobs.sort((a, b) => (a.docId === b.docId ? (a.provider < b.provider ? -1 : 1) : a.docId < b.docId ? -1 : 1)).slice(0, limit);
  console.log(`${todo.length} screens to run (${jobs.length} pending), effort ${effort}`);

  const nextId = (prefix: string) => { let n = 1; while (fs.existsSync(`data/reviews/${prefix}-${n}.json`)) n++; return `${prefix}-${n}`; };
  let done = 0, uncheckable = 0, checkable = 0, problems = 0;
  async function one(j: Job) {
    const doc = s.documents.get(j.docId)!;
    const o0 = s.occurrences.get(j.claims[0].occurrence_ids[0])!;
    const text = getSnapshot(o0.source_version_receipts[0].source_snapshot_id);
    if (!text) { console.log(`${j.docId}: private text missing`); return; }
    const list = j.claims.map((c) => {
      const o = s.occurrences.get(c.occurrence_ids[0])!;
      const q = getPrivateJson<{ quote: string }>("quotes", privateKey(o.id, o.source_version_receipts[0].quote_hash));
      return { claim_id: c.claim_id, exact_words: q?.quote ?? null, where: o.source_version_receipts[0].excerpt_locator, normalized_proposition: c.normalized_proposition, kind: c.kind, modality: c.modality,
        conditions: c.conditions.map((x) => x.text), horizon_as_written: c.original_horizon_text, threshold_as_written: c.original_threshold, target: c.target };
    });
    const asOf = windowEvaluationDate(j.docId, o0.statement_date);
    const user = `EVALUATION DATE: ${asOf}\nPOST: "${doc.title}" by ${subjectName(o0.subject_id)}, published ${o0.statement_date}, ${doc.canonical_url}\nParagraphs are separated by blank lines.\n\n<<<UNTRUSTED SOURCE TEXT: post>>>\n${text.replace(/<<<|>>>/g, "« »")}\n<<<END UNTRUSTED SOURCE TEXT>>>\n\nCLAIMS EXTRACTED FROM THIS POST (${list.length})\n${JSON.stringify(list, null, 1)}`;
    const req = { system, user, schema: ScreenOutput, schemaName: "screen", effort, timeoutMs: 1_500_000 };
    const r = j.provider === "anthropic" ? await callClaudeCli(req) : await callCodexCli(req);
    if (!r.ok && r.status === "unavailable") { console.log(`${j.docId} ${j.provider}: skipped: ${r.error.slice(0, 120)}`); return; }
    const inputs: Record<string, string> = { prompt: ph };
    for (const c of j.claims) inputs[`claim:${c.claim_id}`] = claimDigest(s, c, POLICY_VERSION, ph);
    const id = nextId(`${j.docId}-screen-${j.provider}`);
    putPrivateJson("raw", id, { result: r.ok ? "ok" : r.status, raw: r.raw });
    const run = writePublic(`data/reviews/${id}.json`, ReviewRun, {
      run_id: id, kind: "screen", provider: j.provider, model_requested: CLI_MODELS[j.provider], model_returned: r.model ?? null, via: "cli-login",
      prompt_version: SCREEN_PROMPT.version, prompt_hash: ph, rubric_version: `policy-${POLICY_VERSION}`, input_hashes: inputs,
      started_at: r.startedAt, completed_at: r.completedAt, status: r.ok ? "ok" : r.status, output: r.ok ? r.output : null, error: r.ok ? null : r.error, usage: r.usage, cost_usd: null,
    });
    done++;
    if (!r.ok) { problems++; console.log(`${j.docId} ${j.provider}: ${run.status}: ${run.error?.slice(0, 160)} (${done}/${todo.length})`); return; }
    const entries = r.output.entries;
    const ids = new Set(j.claims.map((c) => c.claim_id));
    const missing = [...ids].filter((x) => entries.filter((e) => e.claim_id === x).length !== 1).length;
    const u = entries.filter((e) => ids.has(e.claim_id) && !e.checkable).length;
    uncheckable += u; checkable += entries.length - u;
    console.log(`${j.docId} ${j.provider}: ${entries.length - u} checkable, ${u} not${missing ? `, ${missing} missing or repeated` : ""} (${done}/${todo.length})`);
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await one(j).catch((e) => console.log(`${j.docId} ${j.provider}: ERROR ${(e as Error).message}`)); }));
  console.log(`done: ${done} screens, ${checkable} checkable answers, ${uncheckable} uncheckable, ${problems} failed`);
}
