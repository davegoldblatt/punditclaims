// node scripts/fix.ts [--limit N] [--concurrency N]
// One fix round for claims the screens read differently from the drafter
// (screen-results status "fix"): the drafter (Claude, on the subscription, no
// tools) rewrites each record from the post and both screens' notes, and the
// result is written as revision 2 of the claim with the reason. The screen then
// runs again on the new revision; a revision the screens still read
// differently is held as a split (scripts/screened.ts).
import fs from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CONFIG, subjectName, SUBJECT_NAMES } from "../src/config.ts";
import { CLAIM_KINDS, CONDITION_TYPES, MODALITIES } from "../src/policy.ts";
import { ClaimRevision, type ScreenOutput } from "../src/schema.ts";
import { loadStore } from "../src/lib/data.ts";
import { hashOf } from "../src/lib/canonical.ts";
import { sealClaim } from "../src/lib/records.ts";
import { privateKey } from "./lib/draft.ts";
import { getPrivateJson, getSnapshot } from "./lib/private-store.ts";
import { callClaudeCli } from "./lib/subscription.ts";
import { writePublic } from "./lib/writer.ts";
import { nowStamp } from "./lib/capture.ts";
import { currentScreen, screenPromptHash } from "./screen.ts";

export const FIX_PROMPT = { version: "fix-1", file: "research/prompts/fix-1.md" };
const Fixed = z.object({ claims: z.array(z.object({
  claim_id: z.string(), normalized_proposition: z.string(), kind: z.enum(CLAIM_KINDS), modality: z.enum(MODALITIES),
  conditions: z.array(z.object({ text: z.string(), type: z.enum(CONDITION_TYPES) }).strict()), horizon_text: z.string().nullable(), revision_reason: z.string(),
}).strict()) }).strict();

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const limit = Number(opt("--limit") ?? Infinity);
const concurrency = Number(opt("--concurrency") ?? 3);
const brief = fs.readFileSync(FIX_PROMPT.file, "utf8").replace(/\{\{site\}\}/g, CONFIG.site.name).replace(/\{\{topic\}\}/g, CONFIG.site.topic).replace(/\{\{subjects\}\}/g, SUBJECT_NAMES);
const briefHash = createHash("sha256").update(brief).digest("hex").slice(0, 12);
const ph = screenPromptHash();
const s = loadStore("data");

const keptAlready = new Set(fs.existsSync("research/corpus/fix-kept.jsonl") ? fs.readFileSync("research/corpus/fix-kept.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).content_hash) : []);
const byPost = new Map<string, ClaimRevision[]>();
for (const l of fs.readFileSync("research/corpus/screen-results.jsonl", "utf8").trim().split("\n").map((x) => JSON.parse(x))) {
  if (l.status !== "fix") continue;
  const c = s.claims.get(l.claim_id)?.at(-1);
  if (!c || c.revision !== 1 || keptAlready.has(c.content_hash)) continue;
  if (!byPost.has(l.post)) byPost.set(l.post, []);
  byPost.get(l.post)!.push(c);
}
const todo = [...byPost].slice(0, limit);
console.log(`${todo.reduce((n, [, c]) => n + c.length, 0)} claims in ${todo.length} posts to fix`);
let done = 0, revised = 0, kept = 0;

async function one([post, claims]: [string, ClaimRevision[]]) {
  const doc = s.documents.get(post)!;
  const o0 = s.occurrences.get(claims[0].occurrence_ids[0])!;
  const text = getSnapshot(o0.source_version_receipts[0].source_snapshot_id);
  if (!text) return;
  const list = claims.map((c) => {
    const o = s.occurrences.get(c.occurrence_ids[0])!;
    const q = getPrivateJson<{ quote: string }>("quotes", privateKey(o.id, o.source_version_receipts[0].quote_hash));
    const screens = (["anthropic", "openai"] as const).map((p) => {
      const e = (currentScreen(s, c, p, ph)?.output as ScreenOutput | undefined)?.entries.find((x) => x.claim_id === c.claim_id);
      return e ? { proposition_faithful: e.proposition_faithful, kind_correct: e.kind_correct, proposed_kind: e.proposed_kind, note: e.note } : null;
    });
    return { claim_id: c.claim_id, exact_words: q?.quote, current: { normalized_proposition: c.normalized_proposition, kind: c.kind, modality: c.modality, conditions: c.conditions, horizon_text: c.original_horizon_text }, screens };
  });
  const user = `POST: "${doc.title}" by ${subjectName(o0.subject_id)}, published ${o0.statement_date}\n\n<<<UNTRUSTED SOURCE TEXT: post>>>\n${text.replace(/<<<|>>>/g, "« »")}\n<<<END UNTRUSTED SOURCE TEXT>>>\n\nRECORDS TO CORRECT (${list.length})\n${JSON.stringify(list, null, 1)}`;
  const r = await callClaudeCli({ system: brief, user, schema: Fixed, schemaName: "fix", effort: "medium", timeoutMs: 1_200_000 });
  done++;
  if (!r.ok) { console.log(`${post}: ${r.status}: ${r.error.slice(0, 160)} (${done}/${todo.length})`); return; }
  for (const c of claims) {
    const f = r.output.claims.find((x) => x.claim_id === c.claim_id);
    if (!f) continue;
    const next = { ...c, normalized_proposition: f.normalized_proposition.slice(0, 600), kind: f.kind, modality: f.modality,
      conditions: f.conditions.map((x) => ({ text: x.text.slice(0, 400), type: x.type, from_source: true })), original_horizon_text: f.horizon_text?.slice(0, 200) ?? null };
    const same = hashOf({ ...next, content_hash: "" }) === hashOf({ ...c, content_hash: "" });
    // Kept as it was: the drafter disagrees with a screen, so it stays held as a split.
    if (same) { kept++; fs.appendFileSync("research/corpus/fix-kept.jsonl", JSON.stringify({ claim_id: c.claim_id, content_hash: c.content_hash, reason: f.revision_reason.slice(0, 400) }) + "\n"); continue; }
    const { content_hash: _h, ...body } = next;
    const sealed = ClaimRevision.safeParse(sealClaim({ ...body, revision: 2, revision_reason: `${f.revision_reason.slice(0, 360)} (fix-1 ${briefHash})`, created_at: nowStamp() }));
    if (!sealed.success) { console.log(`${c.claim_id}: invalid revision: ${sealed.error.issues[0].message}`); continue; }
    writePublic(`data/claims/${c.claim_id}/revisions/2.yaml`, ClaimRevision, sealed.data);
    revised++;
  }
  console.log(`${post}: ${claims.length} claims (${done}/${todo.length})`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await one(j).catch((e) => console.log(`${j[0]}: ERROR ${(e as Error).message}`)); }));
console.log(`done: ${revised} claims revised, ${kept} kept as they were`);
