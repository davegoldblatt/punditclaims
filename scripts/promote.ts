// node scripts/promote.ts --environment preview|production
// Records that the built site in dist/ is being made live: the release it
// renders, the exact commit, and a digest of every built file. Run it after
// the host has accepted that exact artifact. Production also requires a clean
// tree, no open regressions, and the launch floor.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { ActivationReceipt } from "../src/schema.ts";
import { COLLECTION_TARGET } from "../src/policy.ts";
import { loadRelease } from "../src/lib/published.ts";
import { writePublic } from "./lib/writer.ts";
import { nowStamp } from "./lib/capture.ts";

const at = process.argv.indexOf("--environment");
const env = at > 0 ? process.argv[at + 1] : null;
if (env !== "preview" && env !== "production") { console.error("usage: node scripts/promote.ts --environment preview|production"); process.exit(2); }
const m = loadRelease();
if (!m) { console.error("there is no current release"); process.exit(1); }
if (!fs.existsSync("dist/api/release.json")) { console.error("dist/ has no built release export; run npm run build"); process.exit(1); }
const built = JSON.parse(fs.readFileSync("dist/api/release.json", "utf8"));
if (built.digest !== m.digest) { console.error(`dist/ renders release ${built.release_id}, not the current ${m.release_id}; rebuild`); process.exit(1); }
const commit = execSync("git rev-parse HEAD").toString().trim();
if (env === "production") {
  if (execSync("git status --porcelain").toString().trim()) { console.error("refusing: production needs a clean, committed tree"); process.exit(1); }
  if (m.regressions_open.length) { console.error(`refusing: open regressions ${m.regressions_open.join(", ")}`); process.exit(1); }
  const c = m.counts;
  const per = Object.values(c.by_subject);
  if (c.distinct_claims < COLLECTION_TARGET.floor || per.some((n) => n < COLLECTION_TARGET.per_subject_floor)) { console.error(`refusing: ${c.distinct_claims} records (${JSON.stringify(c.by_subject)}) is below the launch floor of ${COLLECTION_TARGET.floor} with ${COLLECTION_TARGET.per_subject_floor} per person`); process.exit(1); }
}
const files: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
walk("dist");
const h = createHash("sha256");
for (const f of files.sort()) h.update(`${path.relative("dist", f)}\0${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}\n`);
const artifact = h.digest("hex");
const prev = fs.existsSync("data/activations") ? fs.readdirSync("data/activations").map((f) => JSON.parse(fs.readFileSync(`data/activations/${f}`, "utf8"))).filter((a) => a.environment === env).sort((a, b) => (a.activated_at < b.activated_at ? 1 : -1))[0] : null;
const now = nowStamp();
const id = `${env}-${now.replace(/[-:]/g, "").toLowerCase()}`;
writePublic(`data/activations/${id}.json`, ActivationReceipt, { activation_id: id, environment: env, kind: prev && prev.release_id === m.predecessor_release_id ? "promote" : prev ? "rollback" : "promote", activated_at: now, release_id: m.release_id, release_digest: m.digest, commit, artifact_digest: artifact, predecessor_activation_id: prev?.activation_id ?? null });
console.log(`recorded ${id}: release ${m.release_id}, artifact ${artifact.slice(0, 12)}, commit ${commit.slice(0, 12)}`);
