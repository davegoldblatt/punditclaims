// Builds a release manifest from the data tree: every claim whose latest
// assessment passes the gate is published, a claim whose newer assessment is
// held keeps its earlier published assessment (dated), everything else held
// is listed with a code-written reason, and every invalidation on file is
// applied. The manifest is the one public dataset; see src/lib/manifest.ts.
import fs from "node:fs";
import YAML from "yaml";
import { MAX_SHARE_OF_DOCUMENT, MAX_WORDS_PER_DOCUMENT, POLICY_VERSION, SCHEMA_VERSION, HELD_LABEL, SUBJECT_IDS, type HeldReason } from "../policy.ts";
import type { Assessment, Event, Invalidation } from "../schema.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "./canonical.ts";
import { contractByHash, revisionByHash, type Store } from "./data.ts";
import { dayOf, latestDay } from "./dates.ts";
import { gate, type GateResult } from "./gate.ts";
import type { HeldRecord, PublicAssessment, PublicClaim, PublicEvent, ReleaseManifest } from "./manifest.ts";
import { computeCounts } from "./published.ts";
import { expectedHorizon, quotedShare } from "./rules.ts";
import { probableCall, probableEligible, probableIndex } from "./probable.ts";

export const NOTICE_TEXT = {
  under_review_neutral: "Under review: a verified problem affects this assessment. It stays readable, dated, until a new assessment passes every check.",
  withdrawn_integrity: "Withdrawn: a verified problem with the quotation or the source means this assessment no longer stands. It is kept here for the record.",
  operational_stale: "A newer review could not complete. This is the last assessment that passed every check, with its own evidence date.",
} as const;
const OPERATIONAL: ReadonlySet<HeldReason> = new Set(["verification_unavailable", "budget_exhausted", "malformed_review"]);

export type BuildInput = { store: Store; referenceDate: string; generatedAt: string; codeCommit: string; predecessor: ReleaseManifest | null; config: { source_windows: Record<string, { id: string; publication: string; origin: string; from: string; to: string; basis: string }[]>; retrieval_cutoff: string } };
export type Built = { body: Omit<ReleaseManifest, "release_id" | "digest">; newEvents: Omit<Event, "release_id">[]; gateResults: Map<string, GateResult>; problems: string[] };

const reviewedOk = (s: Store, a: Assessment) => a.reviewer_run_ids.length === 2 && a.reviewer_run_ids.every((id) => s.reviews.get(id)?.status === "ok");

function projectAssessment(s: Store, a: Assessment, status: PublicAssessment["status"], notice: PublicAssessment["notice"], supersededBy: string | null): PublicAssessment {
  const runs = a.reviewer_run_ids.map((id) => s.reviews.get(id)!);
  const ft = a.final_text_run_id ? s.reviews.get(a.final_text_run_id) : undefined;
  const prod = [...s.activations.values()].filter((x) => x.environment === "production").sort((x, y) => (x.activated_at < y.activated_at ? -1 : 1));
  return {
    assessment_id: a.assessment_id, payload: a.public_payload, payload_hash: a.public_payload_hash, policy_version: a.policy_version, recorded_at: a.recorded_at,
    drafter: a.drafter, reviewers: runs.map((r) => ({ provider: r.provider, model: r.model_returned ?? r.model_requested, run_id: r.run_id })),
    final_text: ft ? { provider: ft.provider, model: ft.model_returned ?? ft.model_requested, run_id: ft.run_id } : null, status, notice, superseded_by: supersededBy,
    evidence_meta: s.packets.get(a.packet_ref.id)!.evidence_items.filter((i) => a.public_payload.evidence.some((e) => e.id === i.id)).map((i) => ({
      id: i.id, source_type: i.source_type, audited: i.audited, derived: i.derived,
      metric: i.metric_scope ? { company: i.metric_scope.company, metric: i.metric_scope.metric, currency: i.metric_scope.currency, units: i.metric_scope.units, accounting_basis: i.metric_scope.accounting_basis, period_start: i.metric_scope.period_start, period_end: i.metric_scope.period_end } : null,
    })),
    // Public history comes from production activations only; until one exists these stay null.
    public_from: prod[0]?.activated_at ?? null, public_until: null,
  };
}

export function buildRelease(inp: BuildInput): Built {
  const s = inp.store;
  const problems = s.problems.map((p) => `${p.file}: ${p.message}`);
  const gateResults = new Map<string, GateResult>();
  const claims: PublicClaim[] = [];
  const held: HeldRecord[] = [];
  const newEvents: Omit<Event, "release_id">[] = [];
  const invalidations = [...s.invalidations.values()].sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1));
  const invFor = (aid: string): Invalidation | undefined => invalidations.filter((i) => i.assessment_id === aid).sort((a, b) => (a.action === "withdraw" ? -1 : 1) - (b.action === "withdraw" ? -1 : 1))[0];
  const prevClaims = new Map((inp.predecessor?.claims ?? []).map((c) => [c.claim_id, c]));
  const byClaim = new Map<string, Assessment[]>();
  for (const a of s.assessments.values()) byClaim.set(a.claim_revision_ref.id, [...(byClaim.get(a.claim_revision_ref.id) ?? []), a]);
  const existingEvents = [...s.events.values()];
  const probables = probableIndex(s);
  const probableOf = (a: Assessment, g: GateResult) => (probableEligible(s, a, g) ? probableCall(s, a, probables) : null);
  const evId = (claimId: string, type: string, aid: string | null) => `${claimId}-${type.replace(/_/g, "-")}-${(aid ?? "none").split("-").at(-1)}`;

  for (const [claimId, list] of [...byClaim].sort(([a], [b]) => (a < b ? -1 : 1))) {
    list.sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1));
    const results = list.map((a) => [a, gate(s, a)] as const);
    for (const [a, g] of results) gateResults.set(a.assessment_id, g);
    const passed = results.filter(([, g]) => g.result === "published").map(([a]) => a);
    const latest = results.at(-1)!;
    const claim = s.claims.get(claimId)!.at(-1)!;
    if (!passed.length) {
      const o = s.occurrences.get(claim.occurrence_ids[0])!;
      const d = s.documents.get(o.document_id)!;
      const g = latest[1] as Extract<GateResult, { result: "held" }>;
      const verified = !["attribution_uncertain", "quote_mismatch", "source_partial", "source_unavailable", "semantic_disagreement"].includes(g.reason);
      const call = probableOf(latest[0], g);
      held.push({ id: claimId, subject_id: claim.subject_id, kind: claim.kind, held_reason: g.reason, since: latest[0].recorded_at, detail: `${HELD_LABEL[g.reason]}. ${g.detail}`.slice(0, 600), source: { url: d.canonical_url, title: d.title, date: o.statement_date }, proposition: verified || call ? claim.normalized_proposition : null, ...(call ? { probable: call, excerpt: o.source_version_receipts[0].public_excerpt } : {}) });
      if (!existingEvents.some((e) => e.claim_id === claimId && e.type === "held" && e.assessment_id === latest[0].assessment_id)) {
        newEvents.push({ event_id: evId(claimId, "held", latest[0].assessment_id), type: "held", claim_id: claimId, claim_revision: claim.revision, assessment_id: latest[0].assessment_id, recorded_at: inp.generatedAt, effective_at: null, actor: "gate", reason: g.detail.slice(0, 600), held_reason: g.reason, predecessor_event_id: null });
      }
      continue;
    }
    // The current assessment: the newest that passed, unless invalidated.
    const current = passed.at(-1)!;
    const history: PublicAssessment[] = passed.slice(0, -1).map((a, i) => projectAssessment(s, a, "superseded", null, passed[i + 1].assessment_id));
    const inv = invFor(current.assessment_id);
    let cur: PublicAssessment | null;
    if (inv?.action === "withdraw") {
      history.push(projectAssessment(s, current, "withdrawn", { kind: "withdrawn_integrity", reason_code: inv.reason_code, text: NOTICE_TEXT.withdrawn_integrity, since: inv.recorded_at }, null));
      cur = null;
    } else if (inv?.action === "flag_under_review") {
      cur = projectAssessment(s, current, "under_review", { kind: "under_review_neutral", reason_code: inv.reason_code, text: NOTICE_TEXT.under_review_neutral, since: inv.recorded_at }, null);
    } else {
      const newer = latest[0] !== current && latest[1].result === "held" ? (latest[1] as Extract<GateResult, { result: "held" }>) : null;
      cur = projectAssessment(s, current, "current", newer && OPERATIONAL.has(newer.reason) ? { kind: "operational_stale", reason_code: null, text: NOTICE_TEXT.operational_stale, since: latest[0].recorded_at } : null, null);
    }
    // Earlier withdrawn assessments stay in history with their notice.
    for (const a of passed.slice(0, -1)) { const i = invFor(a.assessment_id); if (i) { const h = history.find((x) => x.assessment_id === a.assessment_id)!; h.status = i.action === "withdraw" ? "withdrawn" : h.status; h.notice = { kind: i.action === "withdraw" ? "withdrawn_integrity" : "under_review_neutral", reason_code: i.reason_code, text: i.action === "withdraw" ? NOTICE_TEXT.withdrawn_integrity : NOTICE_TEXT.under_review_neutral, since: i.recorded_at }; } }

    const contract = contractByHash(s, claimId, current.contract_ref.content_hash)!;
    const occurrences = claim.occurrence_ids.map((oid) => {
      const o = s.occurrences.get(oid)!;
      const d = s.documents.get(o.document_id)!;
      const r = o.source_version_receipts[0];
      const v = s.versions.get(r.source_snapshot_id)!;
      return { id: oid, statement_date: o.statement_date, statement_date_precision: o.statement_date_precision, excerpt: r.public_excerpt, locator: r.excerpt_locator,
        document: { url: d.canonical_url, title: d.title, publisher: d.publisher, published_at: d.original_published_at, date_uncertain: d.original_date_uncertain, date_provenance: d.original_date_provenance },
        observed_at: v.first_observed_at, observed_via: v.observed_via, archive_url: v.archive_url, access_state: v.access_state, snapshot_hash: v.snapshot_hash, receipts: o.source_version_receipts.length };
    });
    // Review freshness at the release's reference date.
    const completed = list.filter((a) => reviewedOk(s, a)).at(-1)!;
    const lastReview = completed.recorded_at;
    const triggers: string[] = [];
    const end = contract.horizon_interval?.end;
    if (end && latestDay(end) < inp.referenceDate && dayOf(lastReview) <= latestDay(end)) triggers.push("The deadline passed after the last completed review.");
    if (current.next_review_due_at && current.next_review_due_at <= inp.referenceDate) triggers.push("A scheduled review is due.");
    for (const e of existingEvents) if (e.claim_id === claimId && e.type === "evidence_added" && e.recorded_at > lastReview) triggers.push("New evidence was recorded after the last completed review.");
    const horizonNow = current.horizon_state === "conclusive_event" ? "conclusive_event" : current.axis === "forecast_outcome" ? expectedHorizon(contract, inp.referenceDate) : "not_applicable";

    // Events for what changed since the previous release.
    const prev = prevClaims.get(claimId);
    const eventIds = existingEvents.filter((e) => e.claim_id === claimId).map((e) => e.event_id);
    const mkEvent = (type: Event["type"], aid: string, reason: string) => {
      const id = evId(claimId, type, aid);
      if (eventIds.includes(id) || newEvents.some((e) => e.event_id === id)) return;
      newEvents.push({ event_id: id, type, claim_id: claimId, claim_revision: claim.revision, assessment_id: aid, recorded_at: inp.generatedAt, effective_at: null, actor: "gate", reason, held_reason: null, predecessor_event_id: null });
      eventIds.push(id);
    };
    if (cur && prev?.current?.assessment_id !== cur.assessment_id) {
      if (!prev?.current) mkEvent("assessment_published", cur.assessment_id, "First assessment published after both reviews and the final-text check passed.");
      else if (prev.current.payload.outcome !== cur.payload.outcome || prev.current.payload.horizon_state !== cur.payload.horizon_state) mkEvent("assessment_changed", cur.assessment_id, `Reassessed: ${prev.current.payload.outcome} became ${cur.payload.outcome}.`);
      else mkEvent("site_corrected", cur.assessment_id, "A new assessment with the same outcome replaced the previous one.");
    }
    claims.push({
      claim_id: claimId, subject_id: claim.subject_id, revision: claim.revision, content_hash: claim.content_hash, normalized_proposition: claim.normalized_proposition,
      kind: claim.kind, target: claim.target, conditions: claim.conditions, original_horizon_text: claim.original_horizon_text, topic_tags: claim.topic_tags,
      concerns_providers: claim.concerns_providers, selection_stratum: selectionStratum(claimId), occurrences,
      first_statement_date: occurrences.map((o) => o.statement_date).sort()[0], related: claim.relation_to_prior_claim ? [claim.relation_to_prior_claim] : [],
      current: cur, history,
      review: { review_due: triggers.length > 0, triggers, last_completed_review_at: lastReview, next_review_due_at: current.next_review_due_at, horizon_now: horizonNow },
      event_ids: eventIds, last_substantive_change_at: "",
      ...(() => { const call = cur?.status === "current" ? probableOf(current, gateResults.get(current.assessment_id)!) : null; return call ? { probable: call } : {}; })(),
    });
  }

  // Public events: every event on file plus the new ones, newest first.
  const allEvents: PublicEvent[] = [...existingEvents, ...newEvents.map((e) => ({ ...e, release_id: null }))]
    .filter((e) => !e.claim_id || claims.some((c) => c.claim_id === e.claim_id) || held.some((h) => h.id === e.claim_id))
    .map((e) => ({ event_id: e.event_id, type: e.type, claim_id: e.claim_id, subject_id: (claims.find((c) => c.claim_id === e.claim_id)?.subject_id ?? held.find((h) => h.id === e.claim_id)?.subject_id ?? null), assessment_id: e.assessment_id, recorded_at: e.recorded_at, effective_at: e.effective_at, reason: e.reason, substantive: e.type !== "source_discovered" }))
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : a.event_id < b.event_id ? -1 : 1));
  for (const c of claims) {
    c.event_ids = allEvents.filter((e) => e.claim_id === c.claim_id).map((e) => e.event_id);
    c.last_substantive_change_at = allEvents.filter((e) => e.claim_id === c.claim_id && e.substantive).map((e) => e.recorded_at).sort().at(-1) ?? c.current?.recorded_at ?? inp.generatedAt;
  }

  // Quoting limits across the whole release.
  const byDoc = new Map<string, { excerpts: string[]; documentWords: number }>();
  const add = (doc: string, snap: string, excerpt: string) => { const v = s.versions.get(snap); const e = byDoc.get(doc) ?? { excerpts: [], documentWords: Math.round((v?.chars ?? 0) / 6) }; e.excerpts.push(excerpt); byDoc.set(doc, e); };
  for (const c of claims) {
    for (const o of c.occurrences) add(s.occurrences.get(o.id)!.document_id, o.snapshot_hash, o.excerpt);
    for (const a of [c.current, ...c.history]) for (const e of a?.payload.evidence ?? []) { const p = s.packets.get(s.assessments.get(a!.assessment_id)!.packet_ref.id)!; const i = p.evidence_items.find((x) => x.id === e.id)!; add(i.document_id, i.source_snapshot_id, e.excerpt); }
  }
  if (MAX_WORDS_PER_DOCUMENT !== null && MAX_SHARE_OF_DOCUMENT !== null) problems.push(...quotedShare(byDoc, MAX_WORDS_PER_DOCUMENT, MAX_SHARE_OF_DOCUMENT));

  const coverage = coverageWindows(inp, claims, held);
  const regressions = (YAML.parse(fs.readFileSync("fixtures/regressions.yaml", "utf8")) as { id: string; covered_by: string | null }[]).filter((r) => !r.covered_by).map((r) => r.id);
  const subjects = SUBJECT_IDS.map((id) => {
    const x = s.subjects.get(id)!;
    return { id, name: x.name, identification: x.identification, identification_source: x.identification_source, profile_links: x.profile_links,
      windows: (inp.config.source_windows[id] ?? []).map((w) => ({ id: w.id, publication: w.publication, origin: w.origin, from: w.from, to: w.to, basis: w.basis })) };
  });
  const evalCutoff = claims.map((c) => c.current?.payload.evaluation_as_of).filter(Boolean).sort().at(-1) ?? inp.referenceDate;
  const body: Omit<ReleaseManifest, "release_id" | "digest"> = {
    kind: "punditclaims-release", generated_at: inp.generatedAt, reference_date: inp.referenceDate, source_cutoff: inp.config.retrieval_cutoff, evaluation_cutoff: evalCutoff as string,
    schema_version: SCHEMA_VERSION, policy_version: POLICY_VERSION, code_commit: inp.codeCommit, fixture: false, predecessor_release_id: inp.predecessor?.release_id ?? null,
    subjects, claims, held, events: allEvents, coverage, counts: computeCounts(claims, held.length), invalidations_applied: invalidations.map((i) => i.invalidation_id), regressions_open: regressions,
  };
  return { body, newEvents, gateResults, problems };
}

function selectionStratum(claimId: string): string {
  for (const f of fs.existsSync("research/selection") ? fs.readdirSync("research/selection").filter((x) => x.endsWith(".json")) : []) {
    const sel = JSON.parse(fs.readFileSync(`research/selection/${f}`, "utf8")) as { selected?: { claim_id: string; stratum: string }[] };
    const hit = sel.selected?.find((x) => x.claim_id === claimId);
    if (hit) return hit.stratum;
  }
  return "declared-lead";
}

function coverageWindows(inp: BuildInput, claims: PublicClaim[], held: HeldRecord[]) {
  const out = [];
  // Claims found per window, from the corpus ledger: every extracted claim,
  // including those still being checked. Published and held are subsets.
  const found = new Map<string, number>();
  const ledgerFile = "research/corpus/ledger.jsonl";
  if (fs.existsSync(ledgerFile)) {
    const lines = fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const postWindow = new Map<string, string>(lines.filter((l) => l.kind === "post").map((l) => [l.id, l.window]));
    for (const l of lines) if (l.kind === "candidate" && l.status === "claim") { const w = postWindow.get(l.post); if (w) found.set(w, (found.get(w) ?? 0) + 1); }
  }
  for (const [subject, wins] of Object.entries(inp.config.source_windows)) {
    for (const w of wins) {
      const f = `research/coverage/${w.id}.json`;
      const cov = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
      const inWin = (d: string | null) => !!d && d.slice(0, 10) >= w.from && d.slice(0, 10) <= w.to;
      const pub = claims.filter((c) => c.subject_id === subject && c.current && inWin(c.first_statement_date)).length;
      const hd = held.filter((h) => h.subject_id === subject && inWin(h.source.date)).length;
      const t = cov?.totals ?? {};
      out.push({ window_id: w.id, subject_id: subject, publication: w.publication, from: w.from, to: w.to,
        discovered: t.discovered ?? 0, fetched: t.fetched ?? 0, failed: t.failed ?? 0, paywalled: t.paywalled ?? 0, read_in_full: t.read_in_full ?? 0,
        candidates: Math.max(found.get(w.id) ?? 0, pub + hd), selected: pub + hd, published: pub, held: hd,
        notes: cov ? [`Discovered from ${cov.discovery}, ${cov.generated_at.slice(0, 10)}.`] : [w.id === "marcus-legacy" ? "The legacy dataset covered 474 posts; its rows are research candidates only and none is published without the current checks." : "No discovery run has been recorded for this window."] });
    }
  }
  return out;
}

export function sealManifest(body: Omit<ReleaseManifest, "release_id" | "digest">): ReleaseManifest {
  const id = `${body.generated_at.replace(/[-:]/g, "").replace(/\.\d+/, "")}-${hashOf(body).slice(0, 12)}`;
  const withId = { ...body, release_id: id };
  return { ...withId, digest: hashOf(withId, OWN_DIGEST_FIELDS.manifest) } as ReleaseManifest;
}
