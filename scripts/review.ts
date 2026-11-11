// node scripts/review.ts <claim-id>... [--dry-run] [--max-calls N] [--max-input-tokens N] [--max-output-tokens N] [--max-minutes N] [--spend-ceiling USD]
// Runs the two independent reviews, composes the public text, runs the
// final-text check, and records a sealed assessment for each claim. Every run
// has positive limits; a dry run renders the prompts and estimates their size
// without calling any provider. Writes a run report to research/runs/.
import fs from "node:fs";
import { Budget, estimateTokens } from "./lib/vendors.ts";
import { composePayload, finalTextCheck, frozenCase, recordAssessment, reviewClaim, setRoute } from "./lib/review.ts";
import { loadStore } from "../src/lib/data.ts";
import { gate } from "../src/lib/gate.ts";
import { nowStamp } from "./lib/capture.ts";
import type { ReviewOutput } from "../src/schema.ts";

for (const line of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n") : []) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const args = process.argv.slice(2);
const flag = (name: string, dflt: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : dflt; };
const valueFlags = new Set(["--route", "--spend-ceiling", "--max-calls", "--max-input-tokens", "--max-output-tokens", "--max-minutes", "--concurrency"]);
const ids = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && valueFlags.has(args[i - 1])));
const dry = args.includes("--dry-run");
const routeAt = args.indexOf("--route");
const route = (routeAt >= 0 ? args[routeAt + 1] : "api") as "api" | "subscription";
if (route !== "api" && route !== "subscription") { console.error("--route is api or subscription"); process.exit(2); }
setRoute(route);
const budget = new Budget({
  maxCalls: flag("--max-calls", ids.length * 3), maxInputTokens: flag("--max-input-tokens", 100_000 * Math.max(1, ids.length)),
  maxOutputTokens: flag("--max-output-tokens", 60_000 * Math.max(1, ids.length)), maxSeconds: flag("--max-minutes", 30) * 60,
  // The subscription route has no per-call price; the ceiling is then a formality.
  spendCeilingUsd: route === "subscription" ? flag("--spend-ceiling", 1) : flag("--spend-ceiling", Number(process.env.PC_SPEND_CEILING_USD || 0) || NaN),
});
const report: Record<string, unknown>[] = [];
const CONCURRENCY = flag("--concurrency", 4);
// The same agreement the gate requires: same outcome as the draft, and the
// same axis and horizon unless all three say the claim cannot be scored.
const agree = (A: ReviewOutput, B: ReviewOutput, drafted: string) =>
  !A.abstain && !B.abstain && A.outcome === B.outcome && A.outcome === drafted && (A.outcome === "not_adjudicable" || (A.axis === B.axis && A.horizon_state === B.horizon_state));

// --final-only: reuse the latest assessment's two reviews (if both completed
// against the current inputs) and run only the final-text check.
async function finalOnly(id: string) {
  const f = frozenCase(id);
  const s = loadStore("data");
  const latest = [...s.assessments.values()].filter((x) => x.claim_revision_ref.id === id).sort((x, y) => (x.recorded_at < y.recorded_at ? 1 : -1))[0];
  if (!latest) { console.log(`${id}: no assessment to finish`); return; }
  const runs = latest.reviewer_run_ids.map((r) => s.reviews.get(r)!);
  const bound = runs.every((r) => r.status === "ok" && r.input_hashes.claim === f.claim.content_hash && r.input_hashes.contract === f.contract.content_hash && r.input_hashes.packet === f.packet.packet_hash);
  const [A, B] = runs.map((r) => r.output as ReviewOutput);
  const payload = composePayload(id, f);
  if (!bound || !agree(A, B, payload.outcome)) { console.log(`${id}: its reviews do not both agree with the current draft; run a full review`); return; }
  const agreedF = A.outcome === "not_adjudicable" ? { axis: payload.axis, horizon_state: payload.horizon_state, outcome: A.outcome } : A;
  const ft = await finalTextCheck(id, f, payload, agreedF, budget);
  const a = recordAssessment(id, f, payload, latest.reviewer_run_ids, ft.run_id);
  const g = gate(loadStore("data"), a);
  console.log(`${id}:\n  => ${g.result.toUpperCase()}${g.reason ? ` (${g.reason})` : ""}: ${g.detail}`);
  report.push({ claim: id, assessment: a.assessment_id, final_only: true, final_text: ft.run_id, gate: g });
}

async function one(id: string) {
  if (args.includes("--final-only")) return finalOnly(id);
  console.log(`${id}:`);
  if (dry) {
    const f = frozenCase(id);
    console.log(`  frozen case ${f.text.length} characters, about ${estimateTokens(f.text)} input tokens per review`);
    report.push({ claim: id, dry_run: true, est_input_tokens: estimateTokens(f.text) });
    return;
  }
  const { frozen, runs } = await reviewClaim(id, budget);
  const ok = runs.every((r) => r.status === "ok");
  const [A, B] = runs.map((r) => r.output as ReviewOutput | null);
  const payload = composePayload(id, frozen);
  let finalId: string | null = null;
  if (ok && A && B && agree(A, B, payload.outcome)) {
    // When all agree the claim cannot be scored, the axis is a label: tell the final check the drafted one.
    const agreed = A.outcome === "not_adjudicable" ? { axis: payload.axis, horizon_state: payload.horizon_state, outcome: A.outcome } : A;
    finalId = (await finalTextCheck(id, frozen, payload, agreed, budget)).run_id;
  } else console.log("  final-text check skipped: the reviews did not both agree with the draft");
  const a = recordAssessment(id, frozen, payload, runs.map((r) => r.run_id), finalId);
  const g = gate(loadStore("data"), a);
  console.log(`  => ${g.result.toUpperCase()}${g.reason ? ` (${g.reason})` : ""}: ${g.detail}`);
  report.push({ claim: id, assessment: a.assessment_id, reviews: runs.map((r) => ({ provider: r.provider, status: r.status, outcome: r.output && "outcome" in r.output ? r.output.outcome : null })), final_text: finalId, gate: g });
}
const queue = [...ids];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { for (let id = queue.shift(); id; id = queue.shift()) await one(id).catch((e) => { console.log(`${id}: FAILED ${(e as Error).message}`); report.push({ claim: id, error: (e as Error).message }); }); }));
fs.mkdirSync("research/runs", { recursive: true });
const runId = `review-${nowStamp().replace(/[-:]/g, "")}`;
fs.writeFileSync(`research/runs/${runId}.json`, JSON.stringify({ run: runId, dry_run: dry, claims: report, budget: budget.report() }, null, 1) + "\n");
console.log(JSON.stringify(budget.report()));
