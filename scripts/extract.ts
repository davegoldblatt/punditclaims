// node scripts/extract.ts [--window <id>] [--limit N] [--concurrency N] [--force]
// Extracts every claim from every readable post, one Claude call per post on
// the owner's subscription (no tools), with the versioned brief in
// research/prompts/extract-1.md. Code locates every quotation in the captured
// text; a quotation that does not match is rejected with its reason, never
// repaired. Results are private files (they hold full quotations) under
// PRIVATE_DIR/extractions/<document-id>.json; the public ledger is rebuilt
// from them by scripts/corpus.ts. Resumable: posts already extracted are
// skipped unless --force.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import YAML from "yaml";
import { CONFIG, subjectName } from "../src/config.ts";
import { MAX_EXCERPT_WORDS } from "../src/policy.ts";
import { loadStore } from "../src/lib/data.ts";
import { callClaudeCli } from "./lib/subscription.ts";
import { getSnapshot } from "./lib/private-store.ts";
import { excerptInQuote, locateQuote, quoteHash } from "./lib/quote.ts";

import { Candidate, EXTRACT_DIR, EXTRACT_PROMPT } from "./lib/extraction.ts";
const Extraction = z.object({ claims: z.array(Candidate) }).strict();

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const onlyWindow = opt("--window");
const limit = Number(opt("--limit") ?? Infinity);
const concurrency = Number(opt("--concurrency") ?? 4);
const force = args.includes("--force");
const model = process.env.PC_EXTRACT_MODEL || "claude-opus-5-5";

const brief = fs.readFileSync(EXTRACT_PROMPT.file, "utf8");
const briefHash = createHash("sha256").update(brief).digest("hex");
fs.mkdirSync(EXTRACT_DIR, { recursive: true, mode: 0o700 });
const s = loadStore("data");

type Job = { docId: string; subject: string; window: string; title: string; date: string | null; snapshot: string };
const jobs: Job[] = [];
for (const subj of CONFIG.subjects) for (const w of subj.windows) {
  if (onlyWindow && w.id !== onlyWindow) continue;
  const f = `research/coverage/${w.id}.json`;
  if (!fs.existsSync(f)) continue;
  const cov = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const it of cov.items) {
    if (it.status !== "captured" || it.access_state !== "full_public" || !it.snapshot_hash) continue;
    if (!force && fs.existsSync(path.join(EXTRACT_DIR, `${it.document_id}.json`))) continue;
    jobs.push({ docId: it.document_id, subject: subj.id, window: w.id, title: it.title ?? it.document_id, date: it.published_at, snapshot: it.snapshot_hash });
  }
}
const todo = jobs.slice(0, limit);
console.log(`${todo.length} posts to extract (${jobs.length} pending in total)`);

let done = 0, claimsTotal = 0, rejectedTotal = 0;
async function one(j: Job) {
  // Another run may have finished this post since the queue was built.
  if (!force && fs.existsSync(path.join(EXTRACT_DIR, `${j.docId}.json`))) return;
  const text = getSnapshot(j.snapshot);
  if (!text) { console.log(`${j.docId}: private text missing`); return; }
  const system = brief.replace(/\{\{site\}\}/g, CONFIG.site.name).replace(/\{\{topic\}\}/g, CONFIG.site.topic)
    .replace(/\{\{subjects\}\}/g, CONFIG.subjects.map((x) => x.name).join(" and ")).replace(/\{\{author\}\}/g, subjectName(j.subject));
  const user = `POST: "${j.title}" by ${subjectName(j.subject)}, published ${j.date ?? "unknown"}\nParagraphs are separated by blank lines.\n\n<<<UNTRUSTED SOURCE TEXT: post>>>\n${text.replace(/<<<|>>>/g, "« »")}\n<<<END UNTRUSTED SOURCE TEXT>>>`;
  const r = await callClaudeCli({ system, user, schema: Extraction, schemaName: "extraction", model, effort: "medium", timeoutMs: 1_200_000 });
  if (!r.ok) { console.log(`${j.docId}: FAILED ${r.status}: ${r.error.slice(0, 160)}`); return; }
  const kept = [], rejected = [];
  for (const c of r.output.claims) {
    const m = locateQuote(text, c.quote);
    const words = c.excerpt.trim().split(/\s+/).length;
    if (m.status === "failed") rejected.push({ claim: c, reason: "the quotation is not in the post" });
    else if (!excerptInQuote(m.text, c.excerpt)) rejected.push({ claim: c, reason: "the excerpt is not part of the quotation" });
    else if (words > MAX_EXCERPT_WORDS) rejected.push({ claim: c, reason: `the excerpt has ${words} words` });
    else kept.push({ ...c, verified: { status: m.status, start: m.start, end: m.end, exact: m.text, quote_hash: quoteHash(m.text), snapshot: j.snapshot } });
  }
  fs.writeFileSync(path.join(EXTRACT_DIR, `${j.docId}.json`), JSON.stringify({ post: j.docId, subject: j.subject, window: j.window, model: r.model, prompt: EXTRACT_PROMPT.version, prompt_hash: briefHash, extracted_at: r.completedAt, usage: r.usage, claims: kept, rejected }, null, 1), { mode: 0o600 });
  done++; claimsTotal += kept.length; rejectedTotal += rejected.length;
  console.log(`${j.docId}: ${kept.length} claims${rejected.length ? `, ${rejected.length} rejected` : ""} (${done}/${todo.length})`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await one(j).catch((e) => console.log(`${j.docId}: ERROR ${(e as Error).message}`)); }));
console.log(`done: ${done} posts, ${claimsTotal} claims kept, ${rejectedTotal} rejected`);
