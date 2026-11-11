// node scripts/grade.ts [--window <id>] [--limit N] [--claude N] [--codex N] [--batch N] [--only <claim-id,...>]
// Workers from both subscriptions pull batches from one queue: --claude and
// --codex set how many run at once on each.
// Drafts the grading of every claim the screen sent to grading (policy .7),
// a few claims from the same post per call, on the owner's Claude
// subscription. The drafter searches the web and reads pages only through the
// read_page tool (scripts/mcp-read-page.ts), which captures each page; code
// then checks every quotation against the captured text when it ingests the
// draft into a frozen contract and a sealed evidence packet. Reviews come
// later (scripts/review-batch.ts). Results: research/corpus/grade-log.jsonl.
// Resumable: a claim with an ingested packet that has a search record is skipped.
import { evaluationDateFor } from "./lib/evaluation.ts";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { z } from "zod";
import { CONFIG, subjectName, SUBJECT_NAMES } from "../src/config.ts";
import { AXES, CONDITION_STATUSES, DATE_PRECISIONS, HORIZON_STATES, OUTCOMES } from "../src/policy.ts";
import { loadStore, type Store } from "../src/lib/data.ts";
import type { Assessment, BatchReviewOutput, ClaimRevision } from "../src/schema.ts";
import { gate } from "../src/lib/gate.ts";
import { Draft, DRAFT_DIR, ingestDraft, privateKey, type IngestContext } from "./lib/draft.ts";
import { getPrivateJson, putPrivateJson } from "./lib/private-store.ts";
import { callClaudeCli, callCodexCli, CLI_MODELS, tripped } from "./lib/subscription.ts";
import type { Provider } from "../src/policy.ts";
import { isScreenContract } from "../src/lib/screen.ts";
import { EXTRACT_DIR } from "./lib/extraction.ts";

export const GRADE_PROMPT = { version: "grade-4", file: "research/prompts/grade-4.md" };
const ROOT = process.cwd();

const Scope = z.object({
  company: z.string(), metric: z.string(), currency: z.string().nullable(), units: z.string().nullable(),
  accounting_basis: z.enum(["gaap", "ifrs", "non_gaap", "company_reported", "estimate", "unknown"]), fiscal_or_calendar: z.enum(["fiscal", "calendar", "unknown"]),
  period_start: z.string().nullable(), period_end: z.string().nullable(), stock_or_flow: z.enum(["stock", "flow"]),
  annualized_or_realized: z.enum(["annualized", "realized", "not_applicable"]), gross_or_net: z.enum(["gross", "net", "not_applicable"]),
}).strict();
const Interval = z.object({ start: z.string().nullable(), end: z.string().nullable(), precision: z.enum(DATE_PRECISIONS) }).strict();
const Item = z.object({
  id: z.string(), url: z.string(), quote: z.string(), excerpt: z.string(), locator: z.string(),
  role: z.enum(["evidence_of_outcome", "evidence_of_condition", "context"]), relation: z.enum(["supports", "contradicts", "context"]),
  source_type: z.enum(["filing", "company_disclosure", "official_statistics", "independent_measurement", "peer_reviewed", "preprint", "benchmark", "demonstration", "news_report", "secondary_summary"]),
  publisher: z.string(), event_date: z.string(), available_at: z.string(), explanation: z.string(),
  metric_scope: Scope.nullable(), audited: z.boolean().nullable(), derived: z.object({ inputs: z.array(z.string()), formula: z.string(), rounding: z.string() }).strict().nullable(),
}).strict();
const GradeClaim = z.object({
  claim_id: z.string(),
  contract: z.object({
    assessment_axis: z.enum(AXES), explicit_source_elements: z.array(z.string()), evaluator_interpretation: z.array(z.string()),
    support_condition: z.string(), contradiction_condition: z.string(), measurement_requirements: z.string().nullable(), source_requirements: z.string().nullable(),
    metric_scope: Scope.nullable(), horizon_interval: Interval.nullable(), target_period: Interval.nullable(), condition_status: z.enum(CONDITION_STATUSES), early_resolution_rule: z.string().nullable(),
    interpretation_determines_result: z.boolean(), plain_reading: z.boolean(), ambiguity_flags: z.array(z.string()), outcome_known_at_freeze: z.boolean(),
  }).strict(),
  evidence: z.object({
    queries: z.array(z.string()), sources_considered: z.array(z.object({ url: z.string(), used: z.boolean(), why: z.string() }).strict()),
    items: z.array(Item), material_counterevidence: z.array(z.string()), unresolved_gaps: z.array(z.string()),
  }).strict(),
  proposal: z.object({
    outcome: z.enum(OUTCOMES), horizon_state: z.enum(HORIZON_STATES), rationale: z.string(), limitations: z.array(z.string()), what_would_resolve: z.string().nullable(),
    conclusive_event: z.object({ evidence_id: z.string(), event_date: z.string(), meets_rule: z.string() }).strict().nullable(),
  }).strict(),
}).strict();
const GradeBatch = z.object({ claims: z.array(GradeClaim) }).strict();
type GradeClaim = z.infer<typeof GradeClaim>;

const cut = (s: string | null, n: number) => (s == null ? null : s.length > n ? s.slice(0, n - 1) + "…" : s);
const cuts = (a: string[], n: number) => a.filter((x) => x.trim()).map((x) => cut(x, n)!);

function extractedHorizonEnd(docId: string, quoteHash: string, horizonText: string): string | null {
  const f = path.join(EXTRACT_DIR, `${docId}.json`);
  if (!fs.existsSync(f)) return null;
  const x = JSON.parse(fs.readFileSync(f, "utf8")) as { claims: { horizon_text: string | null; horizon_end: string | null; verified: { quote_hash: string } }[] };
  const m = x.claims.find((c) => c.verified.quote_hash === quoteHash && c.horizon_text === horizonText && /^\d{4}-\d{2}-\d{2}$/.test(c.horizon_end ?? ""));
  return m?.horizon_end ?? null;
}

// A single date as the schema wants it. A range keeps its last date, the
// latest the fact can be placed; anything else is left for validation to refuse.
const DATE = /\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4}/g;
function oneDate(x: string): string {
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(x) || /^\d{4}-\d{2}-\d{2}T/.test(x)) return x;
  return x.match(DATE)?.at(-1) ?? x;
}

// The model's answer for one claim, turned into a draft the ingest code accepts.
export function toDraft(s: Store, c: ClaimRevision, g: GradeClaim, drafter: { provider: Provider; model: string }): unknown {
  const o = s.occurrences.get(c.occurrence_ids[0])!;
  const r = o.source_version_receipts[0];
  const doc = s.documents.get(o.document_id)!;
  const q = getPrivateJson<{ quote: string }>("quotes", privateKey(o.id, r.quote_hash))!;
  const k = g.contract;
  const asOf = evaluationDateFor(s, c.claim_id, o.document_id, o.statement_date);
  // A stated deadline is always recorded as an interval: the drafter's, or the
  // extractor's computed last day when the drafter left it out.
  let horizon = c.original_horizon_text ? k.horizon_interval : null;
  if (c.original_horizon_text && !horizon?.end && k.assessment_axis === "forecast_outcome") {
    const end = extractedHorizonEnd(o.document_id, r.quote_hash, c.original_horizon_text);
    // A deadline he gave that cannot be dated ("soon") is still recorded, with no end: it stays open.
    horizon = end ? { start: o.statement_date, end, precision: "day" } : { start: o.statement_date, end: null, precision: "day" };
  }
  // Prospective only for a forecast still open at the cutoff whose outcome the
  // drafter says was not known; any other case keeps the drafter's declaration.
  const notDue = k.assessment_axis === "forecast_outcome" && !!horizon?.end && horizon.end > asOf && !k.outcome_known_at_freeze && g.proposal.horizon_state === "not_due";
  const { claim_id: _a, subject_id: _b, occurrence_ids: _c, revision: _d, revision_reason: _e, created_at: _f, content_hash: _g, ...claimFields } = c;
  return {
    claim_id: c.claim_id, subject_id: c.subject_id, stratum: "corpus", selection_reason: "Full corpus: the screen found this claim checkable (policy .7).", drafter,
    statements: [{ url: doc.canonical_url, quote: q.quote, excerpt: r.public_excerpt, locator: r.excerpt_locator, endorsement: "endorsed", statement_date: o.statement_date }],
    claim: claimFields,
    contract: {
      assessment_axis: k.assessment_axis, explicit_source_elements: cuts(k.explicit_source_elements, 300), evaluator_interpretation: cuts(k.evaluator_interpretation, 400),
      support_condition: cut(k.support_condition, 600), contradiction_condition: cut(k.contradiction_condition, 600),
      measurement_requirements: cut(k.measurement_requirements, 600), source_requirements: cut(k.source_requirements, 600), metric_scope: k.metric_scope,
      original_horizon: c.original_horizon_text, horizon_interval: horizon, target_period: k.target_period,
      // Only a conditional forecast records whether its antecedent happened.
      condition_status: c.kind === "conditional_forecast" ? (k.condition_status === "not_applicable" ? "unknown" : k.condition_status) : "not_applicable",
      early_resolution_rule: cut(k.early_resolution_rule, 400), interpretation_determines_result: k.interpretation_determines_result,
      ...(k.plain_reading ? { plain_reading: true } : {}), ambiguity_flags: cuts(k.ambiguity_flags, 200),
      retrospective_or_prospective: notDue ? "prospective" : "retrospective", outcome_known_at_freeze: notDue ? false : k.outcome_known_at_freeze,
    },
    evidence: {
      evaluation_as_of: asOf, queries: cuts(g.evidence.queries, 300),
      sources_considered: g.evidence.sources_considered.filter((x) => /^https:\/\//.test(x.url)).map((x) => ({ url: x.url, used: x.used, why: cut(x.why, 300) })),
      items: g.evidence.items.map((i) => ({ ...i, event_date: oneDate(i.event_date), available_at: oneDate(i.available_at), id: i.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "e", explanation: cut(i.explanation, 600), locator: cut(i.locator, 200) })),
      material_counterevidence: g.evidence.material_counterevidence, unresolved_gaps: cuts(g.evidence.unresolved_gaps, 400),
    },
    proposal: { ...g.proposal, rationale: cut(g.proposal.rationale, 1600), limitations: cuts(g.proposal.limitations, 400), what_would_resolve: cut(g.proposal.what_would_resolve, 600) },
  };
}

// Criteria a reviewer found unfair to the speaker's words get one redraft,
// whatever the draft's verdict (docs/adr/0005; made outcome-blind after the
// cross-vendor review of 2026-10-30, so the repair never depends on how the
// claim first came out). The reviewers' notes go to the drafter, the
// redraft freezes a new contract and packet, and both providers review it
// again. Returns claim id -> the reviewers' notes on the criteria.
export function toRefit(s: Store): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const log = "research/corpus/grade-log.jsonl";
  const refitDone = new Set<string>();
  if (fs.existsSync(log)) for (const l of fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean)) { const x = JSON.parse(l); if (x.refit && x.result === "ingested") refitDone.add(x.claim_id); }
  const latest = new Map<string, Assessment>();
  for (const a of s.assessments.values()) { const p = latest.get(a.claim_revision_ref.id); if (!p || p.recorded_at < a.recorded_at) latest.set(a.claim_revision_ref.id, a); }
  for (const [id, a] of latest) {
    if (refitDone.has(id)) continue;
    const g = gate(s, a);
    if (g.result !== "held" || g.reason !== "criteria_ambiguous" || !g.detail.includes("criteria unfair")) continue;
    const notes = a.reviewer_run_ids.flatMap((r) => {
      const run = s.reviews.get(r);
      if (run?.status !== "ok" || run.kind !== "batch_review") return [];
      return (run.output as BatchReviewOutput).reviews.filter((x) => x.claim_id === id && !x.contract.fair_to_speaker).map((x) => x.contract.note);
    });
    if (notes.length) out.set(id, notes);
  }
  return out;
}

// Claims the screen sent to grading that have no ingested evidence yet, and
// claims due a refit (above).
export const MAX_ATTEMPTS = 3;
export function toGrade(s: Store, refit: Map<string, string[]> = new Map()): Map<string, ClaimRevision[]> {
  const out = new Map<string, ClaimRevision[]>();
  const packetContracts = new Set([...s.packets.values()].map((p) => p.contract_ref.content_hash));
  if (!fs.existsSync("research/corpus/screen-results.jsonl")) return out;
  // A claim gets at most three drafting attempts. One that fails all three
  // stays unpublished rather than spending the subscriptions forever.
  const failed = new Map<string, number>();
  const log = "research/corpus/grade-log.jsonl";
  if (fs.existsSync(log)) for (const l of fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean)) {
    const x = JSON.parse(l);
    // Answers cut off by the old output pipe, and calls that never got an
    // answer (an outage or a spent subscription, 2026-10-30), were not the
    // claim's failure.
    const notTheClaim = /Unterminated string in JSON at position 81\d\d|exited 1 without an answer|usage limit|rate limit|Connection/.test(x.problems?.[0] ?? "");
    if (x.result !== "ingested" && !notTheClaim) failed.set(x.claim_id, (failed.get(x.claim_id) ?? 0) + 1);
  }
  for (const l of fs.readFileSync("research/corpus/screen-results.jsonl", "utf8").trim().split("\n").map((x) => JSON.parse(x))) {
    if (l.status !== "grade" || (failed.get(l.claim_id) ?? 0) >= MAX_ATTEMPTS) continue;
    const c = s.claims.get(l.claim_id)?.at(-1);
    if (!c) continue;
    const k = s.contracts.get(c.claim_id)?.at(-1);
    // Already drafted and ingested: a matching contract with its packet and draft.
    if (!refit.has(c.claim_id) && k && !isScreenContract(k) && k.claim_revision_ref.content_hash === c.content_hash
      && packetContracts.has(k.content_hash) && fs.existsSync(path.join(DRAFT_DIR, `${c.claim_id}.yaml`))) continue;
    if (!out.has(l.post)) out.set(l.post, []);
    out.get(l.post)!.push(c);
  }
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const limit = Number(opt("--limit") ?? Infinity);
  const workers = { anthropic: Number(opt("--claude") ?? opt("--concurrency") ?? 3), openai: Number(opt("--codex") ?? 0) };
  const batchSize = Number(opt("--batch") ?? 5);
  const only = opt("--only")?.split(",");
  const onlyWindow = opt("--window");
  const effort = (opt("--effort") ?? "high") as "medium" | "high";

  const brief = fs.readFileSync(GRADE_PROMPT.file, "utf8").replace(/\{\{site\}\}/g, CONFIG.site.name).replace(/\{\{topic\}\}/g, CONFIG.site.topic).replace(/\{\{subjects\}\}/g, SUBJECT_NAMES);
  const briefHash = createHash("sha256").update(brief).digest("hex");
  const screens = new Map<string, { tests: (string | null)[]; timing: (string | null)[] }>();
  for (const l of fs.readFileSync("research/corpus/screen-results.jsonl", "utf8").trim().split("\n").map((x) => JSON.parse(x))) screens.set(l.claim_id, l);
  const windowOf = new Map<string, string>();
  for (const subj of CONFIG.subjects) for (const w of subj.windows) {
    const f = `research/coverage/${w.id}.json`;
    if (fs.existsSync(f)) for (const it of JSON.parse(fs.readFileSync(f, "utf8")).items) windowOf.set(it.document_id, w.id);
  }
  let s = loadStore("data");
  const refit = toRefit(s);
  const batches: { post: string; claims: ClaimRevision[] }[] = [];
  for (const [post, claims] of toGrade(s, refit)) {
    if (onlyWindow && windowOf.get(post) !== onlyWindow) continue;
    const list = only ? claims.filter((c) => only.includes(c.claim_id)) : claims;
    // One evaluation date per batch: the prompt states one date for every claim in it.
    const byDate = new Map<string, ClaimRevision[]>();
    for (const c of list) { const o = s.occurrences.get(c.occurrence_ids[0])!; const d = evaluationDateFor(s, c.claim_id, o.document_id, o.statement_date); byDate.set(d, [...(byDate.get(d) ?? []), c]); }
    for (const group of byDate.values()) for (let i = 0; i < group.length; i += batchSize) batches.push({ post, claims: group.slice(i, i + batchSize) });
  }
  const todo = batches.slice(0, limit);
  console.log(`${todo.reduce((n, b) => n + b.claims.length, 0)} claims in ${todo.length} batches to draft (${batches.length} batches pending, ${refit.size} refits)`);
  fs.mkdirSync(DRAFT_DIR, { recursive: true, mode: 0o700 });
  const logFile = "research/corpus/grade-log.jsonl";
  const mcp = { pages: { command: process.execPath, args: ["--no-warnings", path.join(ROOT, "scripts/mcp-read-page.ts")], env: { PC_ROOT: ROOT, PC_PRIVATE_DIR: path.resolve(".cache/private-sources"), PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "", ...(process.env.PC_SUBSTACK_VIA ? { PC_SUBSTACK_VIA: process.env.PC_SUBSTACK_VIA } : {}) } } };

  let done = 0;
  // Ingests run one at a time. Each loads the whole store, and two dozen loads
  // at once ran the process out of memory at 10,000 claims.
  let ingesting: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(f: () => Promise<T>): Promise<T> => { const p = ingesting.then(f, f); ingesting = p.catch(() => {}); return p; };
  async function one(b: { post: string; claims: ClaimRevision[] }, provider: Provider) {
    const doc = s.documents.get(b.post)!;
    const o0 = s.occurrences.get(b.claims[0].occurrence_ids[0])!;
    const list = b.claims.map((c) => {
      const o = s.occurrences.get(c.occurrence_ids[0])!;
      const q = getPrivateJson<{ quote: string; context: string }>("quotes", privateKey(o.id, o.source_version_receipts[0].quote_hash));
      const sc = screens.get(c.claim_id);
      return { claim_id: c.claim_id, exact_words: q?.quote, context: q?.context, normalized_proposition: c.normalized_proposition, kind: c.kind, modality: c.modality,
        conditions: c.conditions.map((x) => x.text), horizon_as_written: c.original_horizon_text, threshold_as_written: c.original_threshold, target: c.target,
        screens_said_evidence_would_be: sc?.tests ?? [], screens_timing: sc?.timing ?? [],
        ...(refit.has(c.claim_id) ? { reviewers_found_earlier_criteria_unfair_to_the_speaker: refit.get(c.claim_id), redraft: "Write criteria that test what the speaker actually said, in their words, then grade against them." } : {}) };
    });
    const asOf = evaluationDateFor(s, b.claims[0].claim_id, o0.document_id, o0.statement_date);
    const user = `EVALUATION DATE: ${asOf}. Use only evidence available on or before it.\nPOST: "${doc.title}" by ${subjectName(o0.subject_id)}, published ${o0.statement_date}, ${doc.canonical_url}\n\nCLAIMS TO GRADE (${list.length}). Each context field is UNTRUSTED SOURCE TEXT from the post.\n${JSON.stringify(list, null, 1).replace(/<<<|>>>/g, "« »")}`;
    const req = { system: brief, user, schema: GradeBatch, schemaName: "grade", effort, timeoutMs: 3_000_000 };
    const r = provider === "anthropic"
      ? await callClaudeCli(req, { builtin: ["WebSearch"], mcp, allowed: ["WebSearch", "mcp__pages__read_page"], maxTurns: 40 + 20 * b.claims.length })
      : await callCodexCli(req, { mcp });
    const drafter = { provider, model: r.model ?? CLI_MODELS[provider] };
    const stamp = new Date().toISOString();
    // A usage limit is not a draft: the batch goes back for a worker that can run it.
    if (!r.ok && r.status === "unavailable") { queue.push(b); return; }
    if (!r.ok) {
      done++;
      // A failed answer is kept privately so a paid draft can be recovered instead of redone.
      if (r.raw) putPrivateJson("raw", `draft-${b.claims[0].claim_id}-${Date.now()}`, { result: r.status, provider, raw: r.raw });
      console.log(`${b.post} [${b.claims.length}]: ${r.status}: ${r.error.slice(0, 160)} (${done}/${todo.length})`);
      fs.appendFileSync(logFile, b.claims.map((c) => JSON.stringify({ claim_id: c.claim_id, at: stamp, stage: "draft", result: r.status, problems: [r.error.slice(0, 300)] })).join("\n") + "\n");
      return;
    }
    const lines = await oneAtATime(async () => {
      // One load per batch: the drafter's page captures are now on disk.
      const ctx: IngestContext = { store: loadStore("data") };
      const lines: string[] = [];
      for (const c of b.claims) {
        const g = r.output.claims.find((x) => x.claim_id === c.claim_id);
        if (!g) { lines.push(JSON.stringify({ claim_id: c.claim_id, at: stamp, stage: "draft", result: "missing", problems: ["the drafter returned nothing for this claim"] })); continue; }
        const d = Draft.safeParse(toDraft(ctx.store, c, g, drafter));
        if (!d.success) { lines.push(JSON.stringify({ claim_id: c.claim_id, at: stamp, stage: "draft", result: "invalid", problems: d.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`) })); continue; }
        const file = path.join(DRAFT_DIR, `${c.claim_id}.yaml`);
        if (refit.has(c.claim_id) && fs.existsSync(file) && !fs.existsSync(file.replace(/\.yaml$/, ".before-refit.yaml"))) fs.copyFileSync(file, file.replace(/\.yaml$/, ".before-refit.yaml"));
        fs.writeFileSync(file, YAML.stringify(d.data, { lineWidth: 0 }), { mode: 0o600 });
        const res = await ingestDraft(c.claim_id, () => {}, ctx);
        lines.push(JSON.stringify({ claim_id: c.claim_id, at: stamp, stage: "ingest", drafter: provider, ...(refit.has(c.claim_id) ? { refit: true } : {}), result: res.problems.length ? "held" : "ingested", outcome: g.proposal.outcome, horizon: g.proposal.horizon_state, items: g.evidence.items.length, held: res.problems.length ? res.held : null, problems: res.problems.slice(0, 4), prompt: GRADE_PROMPT.version, prompt_hash: briefHash, usage: r.usage }));
      }
      fs.appendFileSync(logFile, lines.join("\n") + "\n");
      return lines;
    });
    done++;
    const parsed = lines.map((l) => JSON.parse(l));
    console.log(`${b.post} [${b.claims.length}, ${provider}]: ${parsed.filter((x) => x.result === "ingested").map((x) => x.outcome).join(", ") || "none ingested"}${parsed.some((x) => x.result !== "ingested") ? `; ${parsed.filter((x) => x.result !== "ingested").length} not ingested` : ""} (${done}/${todo.length})`);
  }
  const queue = [...todo];
  const pool = (["anthropic", "openai"] as Provider[]).flatMap((p) => Array.from({ length: workers[p] }, () => p));
  // A worker whose subscription hit its usage limit stops taking batches, then
  // tries again every 10 minutes until the queue is empty.
  const pause = () => new Promise((r) => setTimeout(r, 600_000));
  await Promise.all(pool.map(async (p) => {
    while (queue.length) {
      if (tripped[p]) { await pause(); if (!queue.length) break; tripped[p] = null; continue; }
      const b = queue.shift()!;
      await one(b, p).catch((e) => console.log(`${b.post}: ERROR ${(e as Error).message}`));
    }
  }));
  s = loadStore("data");
  console.log(`done: ${done} batches`);
}
