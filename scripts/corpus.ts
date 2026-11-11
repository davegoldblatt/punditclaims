// node scripts/corpus.ts
// Turns every extraction into sealed public records and rebuilds the corpus
// ledger. Each extracted statement becomes one occurrence and one claim
// (revision 1); its quotation was already located in the captured post by
// code. Existing claims are never rewritten. The ledger has one line per post
// in every window and one per extraction candidate, each with a disposition,
// so "every claim" can be checked (plan v2, F8).
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../src/config.ts";
import { POLICY_VERSION } from "../src/policy.ts";
import { ClaimRevision, Occurrence } from "../src/schema.ts";
import { loadStore } from "../src/lib/data.ts";
import { sealClaim } from "../src/lib/records.ts";
import { ledgerProblems, type CandidateLine, type LedgerLine, type PostLine } from "../src/lib/corpus.ts";
import { EXTRACT_DIR, type Candidate } from "./lib/extraction.ts";
import { privateKey } from "./lib/draft.ts";
import { getSnapshot, putPrivateJson } from "./lib/private-store.ts";
import { excerptInQuote, QUOTE_NORMALIZATION, quoteHash } from "./lib/quote.ts";
import { writePublic } from "./lib/writer.ts";

type Verified = { status: "exact" | "normalized"; start: number; end: number; exact: string; quote_hash: string; snapshot: string };
type Extraction = { post: string; subject: string; window: string; model: string; prompt: string; extracted_at: string; claims: (Candidate & { verified: Verified })[]; rejected: { claim: Candidate; reason: string }[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const s = loadStore("data");
const ledger: LedgerLine[] = [];
let written = 0, existing = 0;

// Graded confidence is kept on the claim as a stated qualifier, so the screen
// and the page both see it.
function conditionsOf(c: Candidate) {
  const type = c.kind === "conditional_forecast" ? ("antecedent" as const) : ("qualifier" as const);
  const out = c.conditions.map((text) => ({ text: text.slice(0, 400), type, from_source: true }));
  if (c.graded_confidence && c.graded_confidence !== "high") out.push({ text: `filed under ${c.graded_confidence} confidence`, type: "qualifier", from_source: true });
  return out;
}

for (const subj of CONFIG.subjects) for (const w of subj.windows) {
  const covFile = `research/coverage/${w.id}.json`;
  if (!fs.existsSync(covFile)) continue;
  const cov = JSON.parse(fs.readFileSync(covFile, "utf8"));
  for (const it of cov.items) {
    const docId: string = it.document_id ?? it.id;
    const base: PostLine = { kind: "post", id: docId, window: w.id, url: it.url, access_state: it.access_state ?? "unknown", status: "pending", candidates: 0, note: null };
    if (it.status === "out_of_window") continue;
    if (it.status === "failed") { ledger.push({ ...base, status: "failed", note: `could not be captured: ${it.error ?? it.access_state ?? "unknown"}` }); continue; }
    if (it.status !== "captured" || it.access_state !== "full_public") {
      ledger.push({ ...base, status: "inaccessible", note: it.access_state === "public_preview" ? "paywalled: only a preview is public" : `not captured (${it.status ?? "unknown"})` });
      continue;
    }
    const f = path.join(EXTRACT_DIR, `${docId}.json`);
    if (!fs.existsSync(f)) { ledger.push(base); continue; }
    const x: Extraction = JSON.parse(fs.readFileSync(f, "utf8"));
    const doc = s.documents.get(docId);
    const lines: CandidateLine[] = [];
    for (const r of x.rejected) lines.push({ kind: "candidate", id: `${docId}-r${lines.length + 1}`, post: docId, quote_hash: "", status: "rejected", claim_id: null, merged_into: null, reason: r.reason });
    // Ids are the post plus the quotation hash's first six characters, counted
    // per prefix, so two different quotations that share a prefix get distinct ids.
    const used = new Map<string, number>();
    for (const c of x.claims) {
      const v = c.verified;
      const prefix = v.quote_hash.slice(0, 6);
      const n = (used.get(prefix) ?? 0) + 1;
      used.set(prefix, n);
      const claimId = `${docId}-${prefix}${n > 1 ? `-${n}` : ""}`;
      const line: CandidateLine = { kind: "candidate", id: claimId, post: docId, quote_hash: v.quote_hash, status: "claim", claim_id: claimId, merged_into: null, reason: null };
      const reject = (reason: string) => lines.push({ ...line, status: "rejected", claim_id: null, reason });
      if (!doc) { reject("the post's document record is missing"); continue; }
      if (c.endorsement !== "endorsed") { reject("the words are someone else's; only the author's own assertions are recorded"); continue; }
      if (!SLUG.test(claimId)) { reject(`cannot form an id from ${docId}`); continue; }
      const prior = s.claims.get(claimId)?.[0];
      if (prior) {
        // The id is taken: it must be this same statement, or the build stops.
        const o = s.occurrences.get(prior.occurrence_ids[0]);
        if (o?.source_version_receipts[0].quote_hash !== v.quote_hash) throw new Error(`${claimId} already belongs to a different quotation; refusing to merge or overwrite`);
        existing++; lines.push(line); continue;
      }
      const date = doc.original_published_at?.slice(0, 10);
      if (!date) { reject("the post has no publication date"); continue; }
      const text = getSnapshot(v.snapshot);
      if (!text || text.slice(v.start, v.end) !== v.exact || quoteHash(v.exact) !== v.quote_hash) { reject("the quotation is no longer at its recorded place in the captured post"); continue; }
      if (!excerptInQuote(v.exact, c.excerpt)) { reject("the excerpt is not part of the quotation"); continue; }
      const occId = `${claimId}-o1`;
      const occurrence = {
        id: occId, subject_id: x.subject, document_id: docId, attributed_speaker: x.subject, endorsement_status: "endorsed",
        statement_date: date, statement_date_precision: "day", extraction_run: `${x.prompt}:${docId}`, claim_ids: [claimId],
        source_version_receipts: [{
          source_snapshot_id: v.snapshot, source_span: { start: v.start, end: v.end }, public_excerpt: c.excerpt, excerpt_locator: c.locator.slice(0, 200), quote_hash: v.quote_hash,
          quote_verification: { status: v.status, normalization_version: QUOTE_NORMALIZATION, verified_at: x.extracted_at, excerpt_in_quote: true },
        }],
        continuity: { status: "single", note: null },
      };
      const tags = c.topic_tags.filter((t) => SLUG.test(t));
      const claimBody = {
        claim_id: claimId, revision: 1, subject_id: x.subject, occurrence_ids: [occId], normalized_proposition: c.normalized_proposition.slice(0, 600), kind: c.kind,
        target: c.target.slice(0, 200), target_version: c.target_version?.slice(0, 120) ?? null, quantifier: null, modality: c.modality, conditions: conditionsOf(c),
        original_horizon_text: c.horizon_text?.slice(0, 200) ?? null, original_threshold: c.threshold?.slice(0, 200) ?? null, metric_scope: null,
        topic_tags: tags.length ? tags : ["other"], concerns_providers: c.concerns_providers, relation_to_prior_claim: null, revision_reason: null, created_at: x.extracted_at,
      };
      const oCheck = Occurrence.safeParse(occurrence), cCheck = ClaimRevision.safeParse(sealClaim(claimBody as never));
      if (!oCheck.success || !cCheck.success) { reject(`not a valid record: ${(oCheck.success ? cCheck : oCheck).error!.issues[0].message}`); continue; }
      const ctx = text.slice(Math.max(0, v.start - 1500), Math.min(text.length, v.end + 1500));
      putPrivateJson("quotes", privateKey(occId, v.quote_hash), { quote: v.exact, context: ctx, snapshot: v.snapshot, start: v.start, end: v.end });
      writePublic(`data/occurrences/${occId}.yaml`, Occurrence, occurrence);
      writePublic(`data/claims/${claimId}/revisions/1.yaml`, ClaimRevision, cCheck.data);
      s.claims.set(claimId, [cCheck.data]);
      s.occurrences.set(occId, oCheck.data as never);
      written++;
      lines.push(line);
    }
    ledger.push({ ...base, status: lines.length ? "extracted" : "zero_claims", candidates: lines.length });
    ledger.push(...lines);
  }
}

fs.mkdirSync("research/corpus", { recursive: true });
fs.writeFileSync("research/corpus/ledger.jsonl", ledger.map((l) => JSON.stringify(l)).join("\n") + "\n");
const posts = ledger.filter((l): l is PostLine => l.kind === "post");
const count = (st: string) => posts.filter((p) => p.status === st).length;
const cands = ledger.filter((l): l is CandidateLine => l.kind === "candidate");
const pending = ledgerProblems(ledger).filter((p) => /no disposition/.test(p)).length;
console.log(`policy ${POLICY_VERSION}: ${posts.length} posts (${count("extracted")} extracted, ${count("zero_claims")} with no claims, ${count("inaccessible")} inaccessible, ${count("pending")} pending)`);
console.log(`${cands.filter((c) => c.status === "claim").length} claims (${written} new, ${existing} already recorded), ${cands.filter((c) => c.status === "rejected").length} candidates rejected; ${pending} ledger lines still pending`);
