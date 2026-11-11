// A draft is the drafter's working file for one claim: the statements, the
// claim, the contract, the evidence, and a proposed assessment. Drafts hold
// full quotations, so they live in private storage (PRIVATE_DIR/drafts), never
// in git. ingestDraft() turns a draft into sealed public records: occurrences,
// a claim revision, a frozen contract, and an evidence packet. Every quotation
// is checked against the captured source text by code. The proposal is never
// shown to the reviewers.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { AXES, CLAIM_KINDS, FULL_ACCESS, MODALITIES, POLICY_VERSION, SUBJECT_IDS } from "../../src/policy.ts";
import {
  ClaimRevision, Condition, EvidencePacket, FinancialScope, Interval, Occurrence, PartialDate, DateOrTimestamp, ResolutionContract, Slug, HttpsUrl,
  PublicExcerpt, Provider, type SourceVersion,
} from "../../src/schema.ts";
import { claimRef, contractRef, sealClaim, sealContract, sealPacket } from "../../src/lib/records.ts";
import { loadStore, type Store } from "../../src/lib/data.ts";
import { hashOf } from "../../src/lib/canonical.ts";
import { captureUrl, canonicalUrl, documentIdFor, nowStamp } from "./capture.ts";
import { getSnapshot, putPrivateJson, PRIVATE_DIR } from "./private-store.ts";
import { excerptInQuote, locateQuote, quoteHash, QUOTE_NORMALIZATION } from "./quote.ts";
import { writePublic } from "./writer.ts";

const Statement = z.object({
  url: HttpsUrl, quote: z.string().min(12), excerpt: PublicExcerpt, locator: z.string().min(1).max(200),
  archive_at: z.string().regex(/^\d{8}$/).optional(), // also capture the archived copy nearest this date, to check the wording as first published
  endorsement: z.enum(["endorsed", "quoted_other", "reported_speech", "ambiguous"]).default("endorsed"),
  statement_date: PartialDate.optional(), // defaults to the document's publication date
}).strict();

const DraftEvidence = z.object({
  id: Slug, url: HttpsUrl, quote: z.string().min(12), excerpt: PublicExcerpt, locator: z.string().min(1).max(200),
  archive_at: z.string().regex(/^\d{8}$/).optional(), // capture the Wayback Machine copy nearest this date when the live page cannot be read
  role: z.enum(["evidence_of_outcome", "evidence_of_condition", "evidence_of_statement", "context"]),
  relation: z.enum(["supports", "contradicts", "context"]),
  source_type: z.enum(["filing", "company_disclosure", "official_statistics", "independent_measurement", "peer_reviewed", "preprint", "benchmark", "demonstration", "news_report", "secondary_summary", "author_statement"]),
  publisher: z.string().min(1), event_date: PartialDate, available_at: DateOrTimestamp, explanation: z.string().min(1).max(600),
  metric_scope: FinancialScope.nullable().default(null), audited: z.boolean().nullable().default(null),
  derived: z.object({ inputs: z.array(z.string()), formula: z.string(), rounding: z.string() }).strict().nullable().default(null),
}).strict();

export const Draft = z.object({
  claim_id: Slug,
  claim_revision_reason: z.string().min(1).max(400).optional(), // required when an ingested claim is changed
  subject_id: z.enum(SUBJECT_IDS),
  stratum: z.enum(["matured-dated-forecast", "open-dated-forecast", "central-recurring", "evidence-changed", "declared-lead", "corpus"]),
  selection_reason: z.string().min(1).max(600),
  drafter: z.object({ provider: Provider, model: z.string().min(1) }).strict().optional(), // absent: the default drafter (Claude)
  legacy_ids: z.array(z.string()).default([]),
  statements: z.array(Statement).min(1),
  claim: z.object({
    normalized_proposition: z.string().min(1).max(600), kind: z.enum(CLAIM_KINDS), target: z.string().min(1).max(200),
    target_version: z.string().max(120).nullable().default(null), quantifier: z.string().max(120).nullable().default(null),
    modality: z.enum(MODALITIES), conditions: z.array(Condition).default([]),
    original_horizon_text: z.string().max(200).nullable().default(null), original_threshold: z.string().max(200).nullable().default(null),
    metric_scope: FinancialScope.nullable().default(null), topic_tags: z.array(Slug).min(1), concerns_providers: z.array(Provider).default([]),
    relation_to_prior_claim: z.object({ claim_id: Slug, relation: z.enum(["repeats", "revises", "narrows", "broadens", "retracts", "related"]) }).strict().nullable().default(null),
  }).strict(),
  contract: z.object({
    assessment_axis: z.enum(AXES),
    explicit_source_elements: z.array(z.string().min(1).max(300)), evaluator_interpretation: z.array(z.string().min(1).max(400)).default([]),
    support_condition: z.string().min(1).max(600), contradiction_condition: z.string().min(1).max(600),
    measurement_requirements: z.string().max(600).nullable().default(null), source_requirements: z.string().max(600).nullable().default(null),
    metric_scope: FinancialScope.nullable().default(null), original_horizon: z.string().max(200).nullable().default(null),
    horizon_interval: Interval.nullable().default(null), target_period: Interval.nullable().default(null),
    condition_status: z.enum(["not_applicable", "met", "not_met", "unknown"]).default("not_applicable"),
    early_resolution_rule: z.string().max(400).nullable().default(null), interpretation_determines_result: z.boolean().default(false), plain_reading: z.boolean().optional(),
    ambiguity_flags: z.array(z.string().min(1).max(200)).default([]), retrospective_or_prospective: z.enum(["retrospective", "prospective"]).default("retrospective"),
    outcome_known_at_freeze: z.boolean(),
  }).strict(),
  evidence: z.object({
    evaluation_as_of: PartialDate,
    queries: z.array(z.string().min(1).max(300)).default([]),
    sources_considered: z.array(z.object({ url: HttpsUrl, used: z.boolean(), why: z.string().max(300) }).strict()).default([]),
    items: z.array(DraftEvidence).default([]),
    material_counterevidence: z.array(Slug).default([]),
    unresolved_gaps: z.array(z.string().min(1).max(400)).default([]),
  }).strict(),
  proposal: z.object({
    outcome: z.enum(["supported", "contradicted", "mixed", "unresolved", "not_adjudicable"]),
    horizon_state: z.enum(["not_applicable", "open_horizon", "not_due", "elapsed", "conclusive_event"]),
    rationale: z.string().min(1).max(1600), limitations: z.array(z.string().max(400)).default([]),
    what_would_resolve: z.string().max(600).nullable().default(null),
    conclusive_event: z.object({ evidence_id: Slug, event_date: PartialDate, meets_rule: z.string().min(1).max(400) }).strict().nullable().default(null),
  }).strict(),
}).strict();
export type Draft = z.infer<typeof Draft>;

export const DRAFT_DIR = path.join(PRIVATE_DIR, "drafts");
export const readDraft = (claimId: string): Draft => Draft.parse(YAML.parse(fs.readFileSync(path.join(DRAFT_DIR, `${claimId}.yaml`), "utf8")));

export type Located = { documentId: string; version: SourceVersion; text: string; start: number; end: number; exact: string; status: "exact" | "normalized" };

// Find the newest observed full-text version of a document that contains the
// quotation, capturing the page first if we have never seen it.
// A caller that ingests many drafts passes ctx, so the data tree is loaded
// once and reloaded only after a capture adds something to it.
export type IngestContext = { store: Store };

export async function locate(url: string, quote: string, log: (s: string) => void, archiveAt?: string, ctx?: IngestContext): Promise<Located | { error: string; held: "source_unavailable" | "source_partial" | "quote_mismatch" }> {
  const documentId = documentIdFor(url);
  let store = ctx?.store ?? loadStore("data");
  let versions = [...store.versions.values()].filter((v) => v.document_id === documentId);
  if (!versions.length) {
    log(`  capturing ${canonicalUrl(url)}${archiveAt ? ` (archived copy near ${archiveAt})` : ""}`);
    const c = await captureUrl(url, { archiveAt });
    if (!c.snapshot_hash) return { error: `could not read ${url}: ${c.error}`, held: "source_unavailable" };
    store = loadStore("data");
    if (ctx) ctx.store = store;
    versions = [...store.versions.values()].filter((v) => v.document_id === documentId);
  }
  versions.sort((a, b) => (a.first_observed_at < b.first_observed_at ? 1 : -1));
  let partial = false;
  for (const v of versions) {
    if (!FULL_ACCESS.has(v.access_state)) { partial = true; continue; }
    const text = getSnapshot(v.snapshot_hash);
    if (!text) continue;
    const m = locateQuote(text, quote);
    if (m.status !== "failed") return { documentId, version: v, text, start: m.start, end: m.end, exact: m.text, status: m.status };
  }
  if (partial && !versions.some((v) => FULL_ACCESS.has(v.access_state))) return { error: `${url}: only a paywall preview was observed`, held: "source_partial" };
  return { error: `${url}: the quotation is not in any observed full version`, held: "quote_mismatch" };
}

const context = (text: string, start: number, end: number, pad = 1500) => text.slice(Math.max(0, start - pad), Math.min(text.length, end + pad));

export type IngestResult = { claimId: string; problems: string[]; held: string | null; packetId: string | null; contract: ResolutionContract | null; claim: ClaimRevision | null; packet: EvidencePacket | null };

export async function ingestDraft(claimId: string, log: (s: string) => void = console.log, ctx?: IngestContext): Promise<IngestResult> {
  const d = readDraft(claimId);
  const problems: string[] = [];
  const now = nowStamp();
  const occIds: string[] = [];
  let held: string | null = null;
  // Nothing is written until every record in the draft is built and valid:
  // a draft that fails anywhere leaves the data tree as it was.
  const pub: { rel: string; schema: z.ZodType; record: unknown }[] = [];
  const priv: { kind: "quotes" | "evidence"; id: string; body: unknown }[] = [];
  const stage = (rel: string, schema: z.ZodType, record: unknown) => {
    const r = schema.safeParse(record);
    if (!r.success) { problems.push(`${rel}: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`); held ??= "policy_mismatch"; return; }
    pub.push({ rel, schema, record });
  };
  const fail = (): IngestResult => ({ claimId, problems, held: held ?? "policy_mismatch", packetId: null, contract: null, claim: null, packet: null });

  // Statements: each becomes an occurrence with a verified receipt.
  const fresh = () => ctx?.store ?? loadStore("data");
  const store = fresh();
  for (const [i, st] of d.statements.entries()) {
    if (st.archive_at) {
      // The archived copy is captured as its own version; the quotation must
      // also appear there, or the wording changed after publication.
      const docId = documentIdFor(st.url);
      const s0 = loadStore("data");
      if (![...s0.versions.values()].some((v) => v.document_id === docId && v.observed_via === "archive")) await captureUrl(st.url, { archiveAt: st.archive_at });
      const archived = [...loadStore("data").versions.values()].filter((v) => v.document_id === docId && v.observed_via === "archive");
      const found = archived.some((v) => { const t = getSnapshot(v.snapshot_hash); return !!t && locateQuote(t, st.quote).status !== "failed"; });
      if (!found) { problems.push(`statement ${i + 1}: the quotation is not in the archived copy near ${st.archive_at}; the wording may have changed`); held ??= "quote_mismatch"; continue; }
    }
    const loc = await locate(st.url, st.quote, log, undefined, ctx);
    if ("error" in loc) { problems.push(loc.error); held ??= loc.held; continue; }
    if (!excerptInQuote(loc.exact, st.excerpt)) { problems.push(`statement ${i + 1}: the excerpt is not part of the quotation`); held ??= "quote_mismatch"; continue; }
    const store = fresh();
    const doc = store.documents.get(loc.documentId)!;
    const date = st.statement_date ?? (doc.original_published_at ? doc.original_published_at.slice(0, 10) : null);
    if (!date) { problems.push(`statement ${i + 1}: no statement date and the document has none`); held ??= "attribution_uncertain"; continue; }
    if (doc.original_author !== d.subject_id && st.endorsement === "endorsed") { problems.push(`statement ${i + 1}: the document's author is ${doc.original_author}, not ${d.subject_id}`); held ??= "attribution_uncertain"; continue; }
    const id = `${claimId}-o${i + 1}`;
    const qh = quoteHash(loc.exact);
    occIds.push(id);
    priv.push({ kind: "quotes", id: privateKey(id, qh), body: { quote: loc.exact, context: context(loc.text, loc.start, loc.end), snapshot: loc.version.snapshot_hash, start: loc.start, end: loc.end } });
    const receipt = { source_snapshot_id: loc.version.snapshot_hash, source_span: { start: loc.start, end: loc.end }, public_excerpt: st.excerpt, excerpt_locator: st.locator, quote_hash: qh, quote_verification: { status: loc.status, normalization_version: QUOTE_NORMALIZATION, verified_at: now, excerpt_in_quote: true } };
    const merged = mergeReceipts(store.occurrences.get(id) ?? null, receipt);
    stage(`data/occurrences/${id}.yaml`, Occurrence, {
      id, subject_id: d.subject_id, document_id: loc.documentId, attributed_speaker: st.endorsement === "endorsed" ? d.subject_id : "other", endorsement_status: st.endorsement,
      statement_date: date, statement_date_precision: "day", extraction_run: store.occurrences.get(id)?.extraction_run ?? `draft-${claimId}`, claim_ids: [claimId],
      source_version_receipts: merged.receipts, continuity: merged.continuity,
    });
  }
  if (problems.length || !occIds.length) return fail();

  // The claim: revision 1, or a new revision when the content changed and the draft says why.
  const prior = store.claims.get(claimId) ?? [];
  const body = { claim_id: claimId, subject_id: d.subject_id, occurrence_ids: occIds, ...d.claim };
  const last = prior.at(-1);
  const comparable = (c: Record<string, unknown>) => hashOf({ ...c, revision: 0, revision_reason: null, created_at: "", content_hash: "" });
  let claim: ClaimRevision;
  if (last && comparable(last) === comparable(body)) claim = last;
  else {
    if (last && !d.claim_revision_reason) { problems.push(`claim ${claimId} already has revision ${last.revision}; a changed claim needs claim_revision_reason in the draft`); return fail(); }
    claim = sealClaim({ ...body, revision: (last?.revision ?? 0) + 1, revision_reason: last ? d.claim_revision_reason! : null, created_at: now });
    stage(`data/claims/${claimId}/revisions/${claim.revision}.yaml`, ClaimRevision, claim);
  }

  // The contract freezes now, before any review sees an outcome.
  const kBody = { claim_id: claimId, claim_revision_ref: claimRef(claim), ...d.contract, policy_version: POLICY_VERSION };
  const kLast = (store.contracts.get(claimId) ?? []).at(-1);
  const strip = (k: Record<string, unknown>) => hashOf({ ...k, version: 0, written_at: "", frozen_at: "", content_hash: "" });
  let contract: ResolutionContract;
  if (kLast && strip(kLast) === strip(kBody)) contract = kLast;
  else {
    contract = sealContract({ ...kBody, version: (kLast?.version ?? 0) + 1, written_at: now, frozen_at: now });
    stage(`data/contracts/${claimId}/${contract.version}.yaml`, ResolutionContract, contract);
  }

  // Evidence: every receipt checked against a captured full version.
  const items = [];
  for (const e of d.evidence.items) {
    const loc = await locate(e.url, e.quote, log, e.archive_at, ctx);
    if ("error" in loc) { problems.push(`evidence ${e.id}: ${loc.error}`); held ??= loc.held === "source_unavailable" ? "evidence_incomplete" : loc.held; continue; }
    if (!excerptInQuote(loc.exact, e.excerpt)) { problems.push(`evidence ${e.id}: the excerpt is not part of the quotation`); held ??= "quote_mismatch"; continue; }
    const qh = quoteHash(loc.exact);
    priv.push({ kind: "evidence", id: privateKey(`${claimId}-${e.id}`, qh), body: { quote: loc.exact, context: context(loc.text, loc.start, loc.end), snapshot: loc.version.snapshot_hash } });
    items.push({
      id: e.id, role: e.role, document_id: loc.documentId, source_snapshot_id: loc.version.snapshot_hash, publisher: e.publisher, source_type: e.source_type,
      url: canonicalUrl(e.url), locator: e.locator, receipt: { public_excerpt: e.excerpt, quote_hash: qh, verified: loc.status },
      event_date: e.event_date, available_at: e.available_at, retrieved_at: loc.version.first_observed_at, relation: e.relation, explanation: e.explanation,
      metric_scope: e.metric_scope, audited: e.audited, derived: e.derived,
    });
  }
  if (problems.length) return fail();
  const pBody = {
    claim_revision_ref: claimRef(claim), contract_ref: contractRef(contract), evaluation_as_of: d.evidence.evaluation_as_of,
    search_record: { queries: d.evidence.queries, sources_considered: d.evidence.sources_considered, performed_at: now },
    evidence_items: items, material_counterevidence: d.evidence.material_counterevidence, unresolved_gaps: d.evidence.unresolved_gaps,
  };
  const same = (p: Record<string, any>) => hashOf({ ...p, packet_id: "", packet_hash: "", search_record: { ...p.search_record, performed_at: "" } });
  const mine = [...store.packets.values()].filter((p) => p.claim_revision_ref.id === claimId);
  const existing = mine.find((p) => same(p) === same(pBody));
  const packet = existing ?? sealPacket({ packet_id: `${claimId}-p${mine.length + 1}`, ...pBody });
  if (!existing) stage(`data/evidence/${packet.packet_id}.json`, EvidencePacket, packet);
  if (problems.length) return fail();

  for (const p of priv) putPrivateJson(p.kind, p.id, p.body);
  for (const w of pub) writePublic(w.rel, w.schema, w.record);
  return { claimId, problems, held, packetId: packet.packet_id, contract, claim, packet };
}

// One authored statement seen in several observed versions of its page keeps
// one occurrence with a receipt per version. The same words in a new version
// (an unrelated edit elsewhere on the page) continue the occurrence; changed
// words are flagged, never silently merged.
type Receipt = Occurrence["source_version_receipts"][number];
export function mergeReceipts(existing: Occurrence | null, r: Receipt): { receipts: Receipt[]; continuity: Occurrence["continuity"] } {
  if (!existing) return { receipts: [r], continuity: { status: "single", note: null } };
  const prior = existing.source_version_receipts;
  if (prior.some((x) => x.source_snapshot_id === r.source_snapshot_id)) return { receipts: prior.map((x) => (x.source_snapshot_id === r.source_snapshot_id ? r : x)), continuity: existing.continuity };
  const sameWords = prior.every((x) => x.quote_hash === r.quote_hash);
  return {
    receipts: [...prior, r],
    continuity: sameWords ? { status: "continued", note: `The same words appear in ${prior.length + 1} observed versions of the page.` } : { status: "ambiguous", note: "The quoted words differ between observed versions of the page." },
  };
}

// Private quotation files are keyed by statement and quotation hash, so a
// corrected quotation is a new private record, never an overwrite.
export const privateKey = (id: string, quoteHash: string) => `${id}-${quoteHash.slice(0, 16)}`;
