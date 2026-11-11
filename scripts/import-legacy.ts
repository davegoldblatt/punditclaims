// node scripts/import-legacy.ts <dataset checkout> --subject <id> --url-template "https://example.org/p/{slug}" [--name <manifest name>]
// Records a legacy claims dataset (the format of marcus-claims-dataset) as a
// quarantined research input: the
// repository, commit, and file hashes it came from, and one candidate per row
// with the legacy fields kept apart under `legacy` so no reviewer prompt or
// public page can mistake them for findings. The source checkout is read,
// never modified. Candidates are leads: every published record is re-sourced
// from the live post and passes the current gate on its own.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { nowStamp } from "./lib/capture.ts";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const repo = args[0];
const subject = opt("--subject");
const template = opt("--url-template");
const name = opt("--name") ?? path.basename(path.resolve(repo ?? "."));
if (!repo || !subject || !template?.includes("{slug}") || !fs.existsSync(path.join(repo, "claude/claude_claims_final.jsonl"))) {
  console.error('usage: node scripts/import-legacy.ts <dataset checkout> --subject <id> --url-template "https://example.org/p/{slug}"'); process.exit(2);
}
const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a]).toString().trim();
const commit = git("rev-parse", "HEAD");
const remote = git("config", "--get", "remote.origin.url");
const dirty = git("status", "--porcelain");
if (dirty) { console.error("refusing: the legacy checkout has local changes"); process.exit(1); }
const files = ["claude/claude_claims_final.jsonl", "claude/claude_do_clustering.py", "outputs/chatgpt/proof/chatgpt_posts_manifest.csv", "outputs/chatgpt/scripts/chatgpt_correctness_refine_precision.py", "DATASET_GUIDE.md"];
const hashes = Object.fromEntries(files.map((f) => [f, { sha256: createHash("sha256").update(fs.readFileSync(path.join(repo, f))).digest("hex"), git_blob: git("rev-parse", `HEAD:${f}`) }]));
const rows = fs.readFileSync(path.join(repo, "claude/claude_claims_final.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const candidates = rows.map((r) => ({
  candidate_id: `legacy-${subject}-${r.id.replace(/_/g, "-")}`,
  subject_id: subject,
  source_url: template.replace("{slug}", r.slug),
  legacy_quote_unverified: r.quote,
  // Everything below is the legacy pipeline's output. It is not evidence,
  // not a verdict, and not passed to reviewers. Dates and quotes in this
  // dataset are often wrong and drop hedges: always re-read the live post.
  legacy: { id: r.id, claim_date: r.claim_date, claim: r.claim, type: r.type, horizon_type: r.horizon_type, horizon_value: r.horizon_value, specificity: r.specificity, falsifiability: r.falsifiability, status_at_eval: r.status_at_eval, evaluation_date: r.evaluation_date, cluster_id: r.cluster_id },
}));
fs.mkdirSync("research/legacy-manifests", { recursive: true });
fs.mkdirSync("research/candidates", { recursive: true });
fs.writeFileSync(`research/candidates/legacy-${subject}.jsonl`, candidates.map((c) => JSON.stringify(c)).join("\n") + "\n");
fs.writeFileSync(`research/legacy-manifests/${name}.json`, JSON.stringify({
  imported_at: nowStamp(), repository: remote, commit, files: hashes, rows: rows.length, migration_version: "legacy-import-1",
  status: "quarantined candidates; no legacy verdict, cluster, or count is published",
  known_failures: ["substring clustering (claude_do_clustering.py) put claim_1865, a regulation recommendation containing 'robust', in the bubble cluster", "the ChatGPT refinement script scored historical observations and conditionals as failed categorical forecasts", "no per-claim outcome evidence or rationale", "statement dates and quotes are often wrong or drop hedges (round-1 pilot: 3 of 9 dates wrong)"],
}, null, 1) + "\n");
console.log(`recorded ${rows.length} quarantined candidates from ${remote} at ${commit.slice(0, 12)}`);
