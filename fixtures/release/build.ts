// Writes fixtures/release/manifest.json: a synthetic release that exercises
// every state a page must render. Every claim, quotation, and number here is
// invented and labelled [Synthetic]; none of it describes Gary Marcus or Ed
// Zitron. Run: node fixtures/release/build.ts
//
// Scale mode: PC_FIXTURE_SCALE=11000 node fixtures/release/build.ts writes a
// synthetic release of that many claims to .runs/fixture-scale/ (never
// committed), in the proportions a full-corpus release is expected to have:
// about 40 percent screened out, the rest graded or not yet due, grouped into
// posts of about ten claims each. Build it with
// PC_RELEASE=fixture PC_FIXTURE_SCALE=11000 npm run build (npm run build:scale).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { hashOf, OWN_DIGEST_FIELDS } from "../../src/lib/canonical.ts";
import { computeCounts, scaleManifestPath, verifyManifest } from "../../src/lib/published.ts";
import { SCREEN_CONDITION, screenRationale } from "../../src/lib/screen.ts";
import type { PublicAssessment, PublicClaim, PublicEvent, HeldRecord, ReleaseManifest } from "../../src/lib/manifest.ts";
import type { PublicPayload } from "../../src/schema.ts";
import {
  HELD_REASONS, POLICY_VERSION, SCHEMA_VERSION, UNCHECKABLE_REASONS,
  type ClaimKind, type HorizonState, type Outcome, type Axis, type UncheckableReason,
} from "../../src/policy.ts";

const SCALE = Number(process.env.PC_FIXTURE_SCALE ?? 0) || 0;
const T = (d: string) => `${d}T12:00:00Z`;
const H = (s: string) => hashOf(s);
const REF = "2026-10-28";
const events: PublicEvent[] = [];
const claims: PublicClaim[] = [];
const PREDICTIONS = "[Synthetic] Predictions for the coming year";
const POSTS = "https://example.org/synthetic/posts/";

type Spec = {
  id: string; subject: "gary-marcus" | "ed-zitron"; kind: ClaimKind; prop: string; axis: Axis; outcome: Outcome; horizon: HorizonState;
  horizonText?: string | null; conditions?: { text: string; type: string; from_source: boolean }[]; excerpt: string; date: string; topics: string[];
  rationale: string; evidence?: { rel: "supports" | "contradicts" | "context"; text: string; date: string }[]; limitations?: string[];
  status?: PublicAssessment["status"]; notice?: PublicAssessment["notice"]; history?: Partial<Spec>[]; withdrawn?: boolean;
  reviewDue?: boolean; horizonNow?: HorizonState; concerns?: ("anthropic" | "openai")[]; occurrences?: number; whatWouldResolve?: string | null; retro?: boolean; stratum?: string;
  // The post the statement comes from (claims that share one are listed together),
  // other posts that repeat it, where in the post it sits, and when it was recorded.
  post?: string; postTitle?: string; alsoIn?: { post: string; title: string; date: string }[]; locator?: string; recorded?: string;
  // Screened out by both providers (policy .7): [anthropic's reason, openai's reason].
  screened?: [UncheckableReason, UncheckableReason];
};

const postUrl = (s: Spec) => `${POSTS}${s.post ?? s.id}`;
const postTitle = (s: Spec) => s.postTitle ?? `[Synthetic] Post for ${s.id}`;
const publisher = (s: Spec) => (s.subject === "gary-marcus" ? "Marcus on AI" : "Where's Your Ed At");

function payload(s: Spec, over: Partial<Spec> = {}): PublicPayload {
  const x = { ...s, ...over };
  const statement = { excerpt: x.excerpt, locator: x.locator ?? "paragraph 7", url: postUrl(s), date: x.date, document_title: postTitle(s), observed_at: T("2026-10-27") };
  if (x.screened) {
    // The shape src/lib/screen.ts composes: only what the speaker stated, no interpretation, no evidence.
    const conditions = (x.conditions ?? []).map((c) => c.text);
    return {
      claim_id: s.id, subject_id: s.subject, normalized_proposition: x.prop, kind: x.kind, conditions, original_horizon_text: x.horizonText ?? null, statement,
      criteria: { from_speaker: [...conditions, ...(x.horizonText ? [x.horizonText] : [])], our_interpretation: [], support_condition: SCREEN_CONDITION, contradiction_condition: SCREEN_CONDITION },
      axis: "not_applicable", outcome: "not_adjudicable", horizon_state: "not_applicable", evaluation_as_of: "2026-10-27",
      rationale: screenRationale(x.screened), limitations: [], evidence: [], what_would_resolve: null, retrospective: true,
      uncheckable: [...new Set(x.screened)].sort(),
    };
  }
  return {
    claim_id: s.id, subject_id: s.subject, normalized_proposition: x.prop, kind: x.kind, conditions: (x.conditions ?? []).map((c) => c.text),
    original_horizon_text: x.horizonText ?? null,
    statement,
    criteria: {
      from_speaker: [x.horizonText ? `deadline: ${x.horizonText}` : "no deadline stated", "the system named in the post"],
      our_interpretation: ["[Synthetic] We read 'ship' as a general public release."],
      support_condition: "[Synthetic] The stated event did not happen within the stated window.",
      contradiction_condition: "[Synthetic] The stated event happened within the stated window.",
    },
    axis: x.axis, outcome: x.outcome, horizon_state: x.horizon, evaluation_as_of: "2026-10-27", rationale: x.rationale, limitations: x.limitations ?? [],
    evidence: (x.evidence ?? []).map((e, i) => ({ id: `${s.id}-ev-${i + 1}`, relation: e.rel, excerpt: e.text, locator: "section 2", url: `https://example.org/synthetic/evidence/${s.id}/${i + 1}`, publisher: "[Synthetic] Example Filings", event_date: e.date, available_at: e.date, explanation: `[Synthetic] Why this item ${e.rel === "context" ? "is context only" : e.rel === "supports" ? "supports the claim" : "goes against the claim"}.` })),
    what_would_resolve: x.whatWouldResolve ?? null, retrospective: x.retro ?? true,
  };
}

function assessment(s: Spec, id: string, p: PublicPayload, status: PublicAssessment["status"], recorded: string, extra: Partial<PublicAssessment> = {}): PublicAssessment {
  // A screened-out claim: the extractor stands as drafter, the two screens as
  // reviewers, and there is no final-text check because code wrote the text.
  const screened = !!p.uncheckable;
  return {
    assessment_id: id, payload: p, payload_hash: hashOf(p), policy_version: POLICY_VERSION, recorded_at: T(recorded),
    drafter: { provider: "anthropic", model: screened ? "fixture-extractor" : "fixture-drafter" },
    reviewers: screened
      ? [{ provider: "anthropic", model: "fixture-screen-a", run_id: `${id}-sa` }, { provider: "openai", model: "fixture-screen-b", run_id: `${id}-sb` }]
      : [{ provider: "anthropic", model: "fixture-reviewer-a", run_id: `${id}-ra` }, { provider: "openai", model: "fixture-reviewer-b", run_id: `${id}-rb` }],
    final_text: screened ? null : { provider: "openai", model: "fixture-verifier", run_id: `${id}-ft` },
    status, notice: null, superseded_by: null, public_from: null, public_until: null,
    evidence_meta: p.evidence.map((e, i) => ({ id: e.id, source_type: i === 0 && s.id === "fx-observation" ? "filing" as const : "company_disclosure" as const, audited: s.id === "fx-observation" && i === 0 ? true : null,
      derived: s.id === "fx-observation" && i === 0 ? { inputs: ["[Synthetic] revenue 4,585", "[Synthetic] operating expenses 12,645"], formula: "expenses minus revenue", rounding: "millions, no rounding" } : null,
      metric: s.id === "fx-observation" && i === 0 ? { company: "[Synthetic] Example Lab", metric: "operating_expenses", currency: "USD", units: "millions", accounting_basis: "gaap", period_start: "2025-01-01", period_end: "2025-12-31" } : null })),
    ...extra,
  };
}

function ev(type: PublicEvent["type"], s: { id: string; subject: Spec["subject"] }, at: string, reason: string, assessment_id: string | null, substantive = true): PublicEvent {
  const e: PublicEvent = { event_id: `fx-ev-${events.length + 1}`, type, claim_id: s.id, subject_id: s.subject, assessment_id, recorded_at: T(at), effective_at: null, reason, substantive };
  events.push(e);
  return e;
}

function add(s: Spec) {
  const mine: PublicEvent[] = [];
  const history: PublicAssessment[] = [];
  const recorded = s.recorded ?? "2026-10-20";
  const published = s.recorded ?? "2026-10-21";
  let n = 0;
  for (const h of s.history ?? []) {
    n++;
    const aid = `${s.id}-a${n}`;
    history.push(assessment(s, aid, payload(s, h), "superseded", `2026-0${n + 3}-15`, { public_from: T(`2026-0${n + 3}-16`), public_until: T(`2026-0${n + 4}-16`) }));
    mine.push(ev("assessment_published", s, `2026-0${n + 3}-16`, "[Synthetic] First assessment published.", aid));
  }
  const aid = `${s.id}-a${n + 1}`;
  let current: PublicAssessment | null = assessment(s, aid, payload(s), s.status ?? "current", recorded, { notice: s.notice ?? null, public_from: T(published) });
  if (history.length) {
    history.at(-1)!.superseded_by = aid;
    mine.push(ev("site_corrected", s, recorded, "[Synthetic] We corrected our reading of the deadline; the new assessment replaces the old one.", aid));
  } else mine.push(ev("assessment_published", s, published, s.screened ? "[Synthetic] Published from the screen: both providers found that public evidence could not settle it." : "[Synthetic] Assessment published.", aid));
  if (s.status === "under_review") mine.push(ev("under_review_flagged", s, "2026-10-25", "[Synthetic] A verified filing conflicts with one evidence item; a new assessment is being prepared.", aid));
  if (s.withdrawn) {
    history.push({ ...current, status: "withdrawn", notice: { kind: "withdrawn_integrity", reason_code: "quote_mismatch", text: "[Synthetic] This assessment was withdrawn because the quotation did not match the source. It is kept here for the record.", since: T("2026-10-26") }, public_until: T("2026-10-26") });
    current = null;
    mine.push(ev("assessment_withdrawn", s, "2026-10-26", "[Synthetic] Withdrawn: the quotation did not match the observed source.", aid));
  }
  const occ = Array.from({ length: Math.max(s.occurrences ?? 1, 1 + (s.alsoIn?.length ?? 0)) }, (_, i) => {
    const other = i ? s.alsoIn?.[i - 1] : undefined;
    return {
      id: `${s.id}-occ-${i + 1}`, statement_date: other ? other.date : i ? `2025-0${Math.min(9, i + 1)}-10` : s.date, statement_date_precision: "day" as const, excerpt: s.excerpt,
      locator: i ? `paragraph ${7 + i}` : s.locator ?? "paragraph 7",
      document: {
        url: other ? `${POSTS}${other.post}` : i ? `${POSTS}${s.id}-${i + 1}` : postUrl(s),
        title: other ? other.title : i ? `[Synthetic] Post ${i + 1} for ${s.id}` : postTitle(s),
        publisher: publisher(s), published_at: other ? other.date : s.date, date_uncertain: false, date_provenance: "article:published_time meta",
      },
      observed_at: T("2026-10-27"), observed_via: "live" as const, archive_url: null, access_state: "full_public" as const, snapshot_hash: H(`${s.id}-${i}`), receipts: 1,
    };
  });
  claims.push({
    claim_id: s.id, subject_id: s.subject, revision: 1, content_hash: H(s.id), normalized_proposition: s.prop, kind: s.kind, target: "[Synthetic] target",
    conditions: s.conditions ?? [], original_horizon_text: s.horizonText ?? null, topic_tags: s.topics, concerns_providers: s.concerns ?? [], selection_stratum: s.stratum ?? (s.screened ? "screened-out" : "declared-lead"),
    occurrences: occ, first_statement_date: s.date, related: [], current, history,
    review: { review_due: !!s.reviewDue, triggers: s.reviewDue ? ["deadline passed after the last completed review"] : [], last_completed_review_at: T("2026-10-20"), next_review_due_at: null, horizon_now: s.horizonNow ?? s.horizon },
    event_ids: mine.map((e) => e.event_id), last_substantive_change_at: mine.filter((e) => e.substantive).map((e) => e.recorded_at).sort().at(-1)!,
  });
}

const long = "[Synthetic] By the end of next year no frontier system will be able to read an arbitrary 400-page novel and reliably answer detailed questions about plot, motive, and character conflict without inventing events that are not in the text, whatever its benchmark scores suggest.";
add({ id: "fx-long-forecast", subject: "gary-marcus", kind: "forecast", prop: long, axis: "forecast_outcome", outcome: "supported", horizon: "elapsed", horizonText: "by the end of 2025", date: "2024-11-03", topics: ["capabilities", "reliability"], excerpt: "[Synthetic] no system will be able to read an arbitrary novel and reliably answer questions about plot, motive and conflict without inventing events, whatever the benchmarks say", rationale: "[Synthetic] Two independent evaluations published before the cutoff found invented plot events on long novels in every system tested.", evidence: [{ rel: "supports", text: "[Synthetic] Every system tested produced at least one invented event per novel.", date: "2025-12-10" }, { rel: "context", text: "[Synthetic] A vendor reported a higher benchmark score on short stories.", date: "2025-11-02" }], stratum: "matured-dated-forecast" });
add({ id: "fx-conditional", subject: "ed-zitron", kind: "conditional_forecast", prop: "[Synthetic] If Example Lab's next funding round falls short, it will cut its compute commitments within two quarters.", axis: "forecast_outcome", outcome: "unresolved", horizon: "open_horizon", conditions: [{ text: "[Synthetic] Example Lab's next funding round falls short", type: "antecedent", from_source: true }], date: "2026-08-18", topics: ["financing"], excerpt: "[Synthetic] if this round falls short, the compute commitments are the first thing to go", rationale: "[Synthetic] The antecedent has not happened: the round has not closed. The conditional is neither confirmed nor falsified.", limitations: ["[Synthetic] 'Falls short' is not defined in the post; we did not choose a threshold."], whatWouldResolve: "[Synthetic] A closed round below the stated target, followed by a disclosed change in commitments." });
add({ id: "fx-not-due", subject: "gary-marcus", kind: "forecast", prop: "[Synthetic] No AI system will perform eight of ten named tasks by the end of 2027.", axis: "forecast_outcome", outcome: "unresolved", horizon: "not_due", horizonText: "by the end of 2027", date: "2024-12-30", topics: ["agi-timelines"], excerpt: "[Synthetic] I do not expect any system to do eight of these ten things by the end of 2027", rationale: "[Synthetic] The deadline has not passed. Absence before the deadline is not failure.", whatWouldResolve: "[Synthetic] A panel finding, after 2027-12-31, on the ten tasks.", retro: false, stratum: "open-dated-forecast" });
add({ id: "fx-contradicted", subject: "ed-zitron", kind: "forecast", prop: "[Synthetic] Example Lab will not raise another round in 2025.", axis: "forecast_outcome", outcome: "contradicted", horizon: "elapsed", horizonText: "in 2025", date: "2025-02-11", topics: ["financing"], excerpt: "[Synthetic] there is no way they raise again this year", rationale: "[Synthetic] A filing shows a closed round in September 2025.", evidence: [{ rel: "contradicts", text: "[Synthetic] The company completed a financing round on September 3, 2025.", date: "2025-09-04" }], stratum: "matured-dated-forecast" });
add({ id: "fx-mixed", post: "fx-post-predictions", postTitle: PREDICTIONS, subject: "gary-marcus", kind: "forecast", prop: "[Synthetic] In 2025 lawsuits over training data will multiply and no court will rule on fair use.", axis: "forecast_outcome", outcome: "mixed", horizon: "elapsed", horizonText: "in 2025", date: "2025-01-01", topics: ["regulation-policy"], excerpt: "[Synthetic] the lawsuits will keep coming, and nobody will get a fair-use ruling this year", rationale: "[Synthetic] The first part holds: new suits were filed. The second does not: one district court ruled on fair use in June.", evidence: [{ rel: "supports", text: "[Synthetic] Filings rose through the year.", date: "2025-12-31" }, { rel: "contradicts", text: "[Synthetic] The court granted summary judgment on fair use.", date: "2025-06-23" }] });
add({ id: "fx-observation", subject: "ed-zitron", kind: "observation", prop: "[Synthetic] Example Lab's 2025 operating expenses exceeded its 2025 revenue.", axis: "historical_observation", outcome: "supported", horizon: "not_applicable", date: "2026-09-29", topics: ["business-economics"], excerpt: "[Synthetic] they spent more running the thing in 2025 than they took in", rationale: "[Synthetic] The filing's 2025 income statement shows operating expenses above revenue. A better 2026 quarter is context, not contradiction.", evidence: [{ rel: "supports", text: "[Synthetic] Total operating expenses for fiscal 2025 were above total revenue.", date: "2025-12-31" }, { rel: "context", text: "[Synthetic] Revenue in Q1 2026 grew faster than expenses.", date: "2026-03-31" }] });
add({ id: "fx-normative", post: "fx-post-predictions", postTitle: PREDICTIONS, subject: "gary-marcus", kind: "normative", prop: "[Synthetic] Governments should require robust third-party audits before deploying open-ended agents.", axis: "not_applicable", outcome: "not_adjudicable", horizon: "not_applicable", date: "2026-10-10", topics: ["regulation-policy", "agents"], excerpt: "[Synthetic] we should require robust independent audits before these agents go anywhere near the open internet", rationale: "[Synthetic] A recommendation is recorded and attributed, not scored." });
add({ concerns: ["openai"], id: "fx-under-review", subject: "ed-zitron", kind: "observation", prop: "[Synthetic] Example Lab's compute commitments exceed ten times its annual revenue.", axis: "historical_observation", outcome: "supported", horizon: "not_applicable", date: "2026-10-06", topics: ["financing"], excerpt: "[Synthetic] the commitments are more than ten times what they bring in a year", rationale: "[Synthetic] Disclosed commitments were above ten times trailing revenue at the time.", evidence: [{ rel: "supports", text: "[Synthetic] Total commitments were disclosed in the filing.", date: "2026-09-30" }], status: "under_review", notice: { kind: "under_review_neutral", reason_code: "verified_material_counterevidence", text: "[Synthetic] Under review: a later filing restates part of the evidence. The assessment below is unchanged until the review completes.", since: T("2026-10-25") } });
add({ id: "fx-corrected", subject: "gary-marcus", kind: "forecast", prop: "[Synthetic] Example Model 5 will not be released in 2024.", axis: "forecast_outcome", outcome: "supported", horizon: "elapsed", horizonText: "this year (2024)", date: "2024-06-21", topics: ["capabilities"], excerpt: "[Synthetic] I am more confident than ever that it will not land this year", rationale: "[Synthetic] No release in 2024; the release came in 2025.", evidence: [{ rel: "supports", text: "[Synthetic] The model was released on August 7, 2025.", date: "2025-08-07" }], history: [{ outcome: "unresolved", horizon: "not_due", rationale: "[Synthetic] Earlier assessment: we misread the deadline as 2025." }] });
add({ id: "fx-withdrawn", subject: "ed-zitron", kind: "forecast", prop: "[Synthetic] Example Lab will stop offering its free tier by mid-2026.", axis: "forecast_outcome", outcome: "contradicted", horizon: "elapsed", horizonText: "by mid-2026", date: "2025-10-01", topics: ["business-economics"], excerpt: "[Synthetic] the free tier is gone by the middle of next year", rationale: "[Synthetic] The free tier was still offered on July 1, 2026.", evidence: [{ rel: "contradicts", text: "[Synthetic] The pricing page listed a free plan.", date: "2026-07-01" }], withdrawn: true });
add({ id: "fx-review-due", subject: "gary-marcus", kind: "forecast", prop: "[Synthetic] Fully driverless taxis will operate in fewer than ten cities by September 2026.", axis: "forecast_outcome", outcome: "unresolved", horizon: "not_due", horizonText: "by September 2026", date: "2025-03-02", topics: ["capabilities"], excerpt: "[Synthetic] fewer than ten cities, even by September next year", rationale: "[Synthetic] Assessed before the deadline: not yet due.", reviewDue: true, horizonNow: "elapsed", whatWouldResolve: "[Synthetic] A count of cities with public driverless service on 2026-09-30.", occurrences: 3, stratum: "central-recurring" });

// Screened out (policy .7): both providers found that public evidence could
// not settle these. No evidence, no final-text check; code composes the text.
add({ id: "fx-screened-value", post: "fx-post-predictions", postTitle: PREDICTIONS, subject: "gary-marcus", kind: "normative", prop: "[Synthetic] Labs ought to slow down before releasing systems they cannot explain.", axis: "not_applicable", outcome: "not_adjudicable", horizon: "not_applicable", date: "2025-01-01", topics: ["regulation-policy"], excerpt: "[Synthetic] the labs ought to slow down until they can explain what they are shipping", rationale: "", screened: ["value_judgment", "value_judgment"], concerns: ["anthropic"], locator: "paragraph 3 of 40" });
add({ id: "fx-screened-rhetoric", subject: "ed-zitron", kind: "rhetoric", prop: "[Synthetic] The whole industry is a house of cards waiting for a breeze.", axis: "not_applicable", outcome: "not_adjudicable", horizon: "not_applicable", date: "2025-06-02", topics: ["business-economics"], excerpt: "[Synthetic] this whole industry is a house of cards, and it is waiting for a breeze", rationale: "", screened: ["rhetoric", "no_plain_reading"] });
add({ id: "fx-screened-chance", post: "fx-post-predictions", postTitle: PREDICTIONS, subject: "gary-marcus", kind: "forecast", prop: "[Synthetic] There is a decent chance that a major lab scales back its spending within a few years.", axis: "not_applicable", outcome: "not_adjudicable", horizon: "not_applicable", horizonText: "within a few years", date: "2025-01-01", topics: ["financing"], excerpt: "[Synthetic] I would put decent odds on a major lab scaling back its spending within a few years", rationale: "", screened: ["probability_language", "probability_language"], locator: "paragraph 31 of 40" });

const held: HeldRecord[] = [
  { id: "fx-held-paywall", subject_id: "ed-zitron", held_reason: "source_partial", since: T("2026-10-27"), detail: "Only the free preview of this post could be read, so the quotation could not be checked against the full text.", source: { url: "https://example.org/synthetic/held-1", title: "[Synthetic] Premium post", date: "2026-07-14" }, proposition: null },
  { id: "fx-held-split", subject_id: "gary-marcus", held_reason: "assessment_disagreement", since: T("2026-10-27"), detail: "The two reviews reached different assessments (supported and mixed). Both are recorded; nothing is published until they agree.", source: { url: "https://example.org/synthetic/posts/fx-post-predictions", title: PREDICTIONS, date: "2025-01-01" }, proposition: "[Synthetic] Reliable research agents will not arrive by the end of 2025." },
  { id: "fx-held-outage", subject_id: "gary-marcus", held_reason: "verification_unavailable", since: T("2026-10-27"), detail: "One required review could not run. The record waits for it; an outage is never treated as a finding.", source: { url: "https://example.org/synthetic/held-3", title: "[Synthetic] Post", date: "2026-03-09" }, proposition: null },
];

const windows = [
  { window_id: "marcus-legacy", subject_id: "gary-marcus" as const, publication: "Marcus on AI", from: "2022-05-01", to: "2026-03-02", discovered: 474, fetched: 470, failed: 4, paywalled: 0, read_in_full: 470, candidates: 120, selected: 18, published: 6, held: 2, notes: ["[Synthetic] Counts are invented for layout."] },
  { window_id: "marcus-current", subject_id: "gary-marcus" as const, publication: "Marcus on AI", from: "2026-03-03", to: "2026-10-28", discovered: 88, fetched: 88, failed: 0, paywalled: 3, read_in_full: 85, candidates: 30, selected: 6, published: 0, held: 0, notes: [] },
  { window_id: "zitron-wyea", subject_id: "ed-zitron" as const, publication: "Where's Your Ed At", from: "2023-01-01", to: "2026-10-28", discovered: 210, fetched: 205, failed: 5, paywalled: 40, read_in_full: 165, candidates: 60, selected: 14, published: 5, held: 1, notes: ["[Synthetic] Premium posts are counted and not read."] },
];


// --- scale mode -------------------------------------------------------------------
// Deterministic synthetic claims in the expected proportions. The words are
// drawn from a fixed list so the search index has realistic variety.
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = ("model models lab labs compute revenue spending capital funding round valuation chips data center centers training inference benchmark benchmarks agent agents " +
  "reasoning reliability hallucination errors customers enterprise adoption pricing subscription users growth losses profit margin margins debt investors bubble " +
  "regulation policy lawsuit copyright court ruling safety audit release launch product products deadline quarter year years months market markets share shares " +
  "startup startups cloud contract contracts partner partnership electricity power grid capacity GPU GPUs cluster scale scaling law laws plateau progress robot robots " +
  "car cars taxi cities vision video speech code coding developers tools search engine ads advertising churn retention costs cost token tokens billing price " +
  "public private filing earnings report reports forecast evidence claim claims system systems frontier open source weights research paper papers study").split(" ");
const TOPICS = ["agi-timelines", "agents", "business-economics", "capabilities", "chips-compute", "coding", "copyright", "energy", "enterprise-adoption", "financing",
  "hallucination", "labor", "open-models", "pricing", "regulation-policy", "reliability", "robotics", "safety", "scaling", "search", "self-driving", "valuation"];

function scale(total: number) {
  const r = rng(total);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const sentence = (n: number) => { const w = words(n); return w.charAt(0).toUpperCase() + w.slice(1) + "."; };
  const day = (from: string, to: string) => new Date(Date.parse(from) + Math.floor(r() * (Date.parse(to) - Date.parse(from)))).toISOString().slice(0, 10);
  // Posts of about ten claims each.
  type Post = { key: string; title: string; date: string; subject: Spec["subject"]; size: number };
  const posts: Post[] = [];
  let planned = 0;
  while (planned < total) {
    const size = Math.min(60, 1 + Math.floor(-Math.log(1 - r()) * 9), total - planned);
    const subject = r() < 0.6 ? "gary-marcus" : "ed-zitron";
    const key = `fx-s${subject === "gary-marcus" ? "m" : "z"}-post-${posts.length + 1}`;
    posts.push({ key, title: `[Synthetic] ${sentence(4 + Math.floor(r() * 6)).slice(0, -1)}`, date: day(subject === "gary-marcus" ? "2022-05-01" : "2023-01-01", "2026-10-27"), subject, size });
    planned += size;
  }
  const otherPost = (p: Post) => { const q = pick(posts.filter((x) => x.subject === p.subject && x !== p)); return q ? [{ post: q.key, title: q.title, date: q.date }] : []; };
  let i = 0;
  for (const p of posts) {
    for (let k = 0; k < p.size; k++, i++) {
      const id = `fx-s-${String(i + 1).padStart(5, "0")}`;
      const u = r();
      const horizonText = r() < 0.6 ? `by the end of ${2023 + Math.floor(r() * 6)}` : null;
      const common = {
        id, subject: p.subject, post: p.key, postTitle: p.title, date: p.date, locator: `paragraph ${k * 4 + 3} of ${p.size * 4 + 10}`,
        recorded: day("2026-10-01", "2026-10-27"), topics: [...new Set(Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(TOPICS)))],
        prop: `[Synthetic] ${sentence(18 + Math.floor(r() * 22))}`, excerpt: `[Synthetic] ${words(25 + Math.floor(r() * 40))}`,
        concerns: r() < 0.05 ? [pick(["anthropic", "openai"] as const)] : [],
        alsoIn: r() < 0.05 ? otherPost(p) : [],
      };
      const item = (rel: "supports" | "contradicts" | "context") => ({ rel, text: `[Synthetic] ${sentence(20 + Math.floor(r() * 25))}`, date: day("2023-01-01", "2026-10-20") });
      const rationale = `[Synthetic] ${sentence(30 + Math.floor(r() * 50))} ${sentence(15 + Math.floor(r() * 20))}`;
      const limitations = r() < 0.4 ? [`[Synthetic] ${sentence(12 + Math.floor(r() * 15))}`] : [];
      let spec: Spec;
      if (u < 0.40) {
        // Screened out: both providers give a reason; often the same one.
        const a = pick(UNCHECKABLE_REASONS);
        const b = r() < 0.6 ? a : pick(UNCHECKABLE_REASONS);
        const kind: ClaimKind = a === "value_judgment" ? "normative" : a === "rhetoric" ? "rhetoric" : pick(["forecast", "observation", "causal"] as const);
        spec = { ...common, kind, axis: "not_applicable", outcome: "not_adjudicable", horizon: "not_applicable", horizonText, rationale: "", screened: [a, b], stratum: "screened-out" };
      } else if (u < 0.45) {
        // Graded in full and still not adjudicable: a recommendation.
        spec = { ...common, kind: "normative", axis: "not_applicable", outcome: "not_adjudicable", horizon: "not_applicable", rationale, limitations };
      } else if (u < 0.86) {
        const g = r();
        const outcome: Outcome = g < 0.34 ? "supported" : g < 0.63 ? "contradicted" : g < 0.75 ? "mixed" : "unresolved";
        const evidence = outcome === "unresolved" ? (r() < 0.5 ? [item("context")] : [])
          : [item(outcome === "contradicted" ? "contradicts" : "supports"), ...(outcome === "mixed" ? [item("contradicts")] : []), ...(r() < 0.5 ? [item("context")] : []), ...(r() < 0.3 ? [item("supports")] : [])];
        spec = r() < 0.7
          ? { ...common, kind: "forecast", axis: "forecast_outcome", outcome, horizon: outcome === "unresolved" && r() < 0.4 ? "open_horizon" : "elapsed", horizonText: horizonText ?? "by the end of 2025", rationale, limitations, evidence, whatWouldResolve: outcome === "unresolved" ? `[Synthetic] ${sentence(15)}` : null }
          : { ...common, kind: "observation", axis: "historical_observation", outcome, horizon: "not_applicable", rationale, limitations, evidence };
      } else {
        // Not yet due.
        spec = { ...common, kind: "forecast", axis: "forecast_outcome", outcome: "unresolved", horizon: "not_due", horizonText: `by the end of ${2027 + Math.floor(r() * 4)}`, rationale, limitations, retro: false, whatWouldResolve: `[Synthetic] ${sentence(15)}`, stratum: "open-dated-forecast" };
        if (r() < 0.07) { spec.reviewDue = true; spec.horizonNow = "elapsed"; }
      }
      const f = r();
      if (!spec.screened && f < 0.02) spec.history = [{ outcome: "unresolved", horizon: spec.axis === "forecast_outcome" ? "not_due" : spec.horizon, rationale: `[Synthetic] Earlier assessment. ${sentence(20)}` }];
      else if (!spec.screened && f < 0.024) { spec.status = "under_review"; spec.notice = { kind: "under_review_neutral", reason_code: "verified_material_counterevidence", text: "[Synthetic] Under review: a later filing restates part of the evidence.", since: T("2026-10-25") }; }
      else if (f < 0.027) spec.withdrawn = true;
      add(spec);
    }
  }
  // Held records, about 3 percent, each from one of the posts, each with its event.
  const out: HeldRecord[] = [];
  for (let h = 0; h < Math.round(total * 0.03); h++) {
    const p = pick(posts);
    const id = `fx-held-s-${String(h + 1).padStart(4, "0")}`;
    const since = day("2026-10-01", "2026-10-27");
    out.push({ id, subject_id: p.subject, held_reason: pick(HELD_REASONS), since: T(since), detail: "[Synthetic] The record did not pass every check. It waits for the missing check; nothing about it is published.", source: { url: `${POSTS}${p.key}`, title: p.title, date: p.date }, proposition: r() < 0.5 ? `[Synthetic] ${sentence(20)}` : null });
    ev("held", { id, subject: p.subject }, since, "[Synthetic] Held: a required check did not pass.", null);
  }
  return { held: out, posts: posts.length };
}

const scaled = SCALE ? scale(Math.max(0, SCALE - claims.length)) : null;
if (scaled) held.push(...scaled.held);

const commit = execSync("git rev-parse HEAD").toString().trim();
const body: Omit<ReleaseManifest, "digest"> = {
  kind: "punditclaims-release", release_id: `20261028T120000Z-${hashOf(SCALE ? `fixture-scale-${SCALE}` : "fixture").slice(0, 12)}`, generated_at: T(REF), reference_date: REF,
  source_cutoff: REF, evaluation_cutoff: "2026-10-27", schema_version: SCHEMA_VERSION, policy_version: POLICY_VERSION, code_commit: commit,
  fixture: true, predecessor_release_id: null,
  subjects: [
    { id: "gary-marcus", name: "Gary Marcus", identification: "Scientist and author who writes the newsletter Marcus on AI.", identification_source: { title: "Marcus on AI, About", url: "https://garymarcus.substack.com/about" }, profile_links: [{ label: "Marcus on AI", url: "https://garymarcus.substack.com" }], windows: [{ id: "marcus-legacy", publication: "Marcus on AI", origin: "https://garymarcus.substack.com", from: "2022-05-01", to: "2026-03-02", basis: "Legacy corpus." }, { id: "marcus-current", publication: "Marcus on AI", origin: "https://garymarcus.substack.com", from: "2026-03-03", to: "2026-10-28", basis: "Posts after the legacy snapshot." }] },
    { id: "ed-zitron", name: "Ed Zitron", identification: "Writer of the newsletter Where's Your Ed At and host of the podcast Better Offline.", identification_source: { title: "Where's Your Ed At, About", url: "https://www.wheresyoured.at/about/" }, profile_links: [{ label: "Where's Your Ed At", url: "https://www.wheresyoured.at" }], windows: [{ id: "zitron-wyea", publication: "Where's Your Ed At", origin: "https://www.wheresyoured.at", from: "2023-01-01", to: "2026-10-28", basis: "Posts from the publication's sitemap." }] },
  ],
  claims, held, events, coverage: windows, counts: computeCounts(claims, held.length), invalidations_applied: [], regressions_open: [],
};
const manifest = { ...body, digest: hashOf(body, OWN_DIGEST_FIELDS.manifest) };
verifyManifest(manifest, { fixture: true });
if (SCALE) {
  const f = scaleManifestPath(SCALE, process.cwd());
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(manifest) + "\n");
  const screened = claims.filter((c) => c.current?.payload.uncheckable).length;
  console.log(`wrote ${path.relative(process.cwd(), f)}: ${claims.length} claims (${screened} screened out) from ${scaled!.posts} posts, ${held.length} held, ${events.length} events`);
} else {
  fs.writeFileSync(new URL("./manifest.json", import.meta.url), JSON.stringify(manifest, null, 1) + "\n");
  console.log(`wrote fixtures/release/manifest.json: ${claims.length} claims, ${held.length} held, ${events.length} events`);
}
