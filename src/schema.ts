// Every record family, as zod schemas. The build and `npm run validate` fail on
// a record that breaks them. These are file formats, not database tables: each
// record is one YAML or JSON file in data/, and git history is the audit trail.
//
// Three ideas run through all of it:
// - A statement (occurrence) is what someone said, a claim is what the
//   statement commits them to, and an assessment is our judgment at a stated
//   evidence cutoff. They are different records.
// - Records are immutable once written. A change is a new revision, a new
//   version, or a new assessment that supersedes the old one.
// - Anything public is an allowlisted projection. Full quotations and source
//   text live in private storage (see scripts/lib/private-store.ts).
import { z } from "zod";
import { earliestDay, latestDay } from "./lib/dates.ts";
import {
  ACCESS_STATES, AXES, AXES_FOR_KIND, CLAIM_KINDS, CONDITION_STATUSES, CONDITION_TYPES, DATE_PRECISIONS, DISPOSITIONS,
  ENDORSEMENTS, EVENT_TYPES, EVIDENCE_RELATIONS, EVIDENCE_SOURCE_TYPES, HELD_REASONS, HORIZON_STATES, HORIZON_STATES_FOR_AXIS,
  INVALIDATION_ACTIONS, INVALIDATION_REASONS, MAX_EXCERPT_WORDS, MAX_REVIEW_TEXT, MODALITIES, OUTCOMES, PROVIDERS,
  RELATIONS_TO_PRIOR, SOURCE_TYPES, SUBJECT_IDS, WITHDRAW_REASONS, UNCHECKABLE_REASONS, CHECK_TIMING,
} from "./policy.ts";

// --- primitives --------------------------------------------------------------

// Dates stay strings exactly as written. YYYY, YYYY-MM, YYYY-MM-DD, or an ISO
// timestamp. Never a Date object: a time zone must not move a day.
// A real calendar date: 2026-02-31 and 2026-13-01 are refused.
export function isCalendarDate(d: string): boolean {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(d);
  if (!m) return false;
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) : 1, day = m[3] ? Number(m[3]) : 1;
  if (mo < 1 || mo > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
export const PartialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "a date: YYYY, YYYY-MM, or YYYY-MM-DD").refine(isCalendarDate, "a real calendar date");
export const Timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/, "a UTC timestamp: YYYY-MM-DDTHH:MM:SSZ")
  .refine((t) => isCalendarDate(t.slice(0, 10)) && Number.isFinite(Date.parse(t)) && Number(t.slice(11, 13)) < 24 && Number(t.slice(14, 16)) < 60, "a real UTC time");
export const DateOrTimestamp = z.union([PartialDate, Timestamp]);
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "a sha256 hex digest");
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "a kebab-case id");
export const HttpsUrl = z.string().url().refine((u) => u.startsWith("https://"), "an https URL");
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const PublicExcerpt = z.string().min(1).refine((s) => words(s) <= MAX_EXCERPT_WORDS, `a public excerpt of at most ${MAX_EXCERPT_WORDS} words`);
const Bounded = z.string().max(MAX_REVIEW_TEXT);

export const SubjectId = z.enum(SUBJECT_IDS);
export const Provider = z.enum(PROVIDERS);
export const DatePrecision = z.enum(DATE_PRECISIONS);

export const Ref = z.object({ id: z.string().min(1), version: z.union([z.number().int().positive(), z.string().min(1)]), content_hash: Sha256 }).strict();
export type Ref = z.infer<typeof Ref>;

// --- subjects ------------------------------------------------------------------

export const Subject = z.object({
  id: SubjectId,
  name: z.string().min(1),
  identification: z.string().min(1).max(400),
  identification_source: z.object({ title: z.string().min(1), url: HttpsUrl }).strict(),
  statement_origins: z.array(HttpsUrl).min(1),
  collection_windows: z.array(z.string().min(1)).min(1), // ids from policy/policy.yaml source_windows
  active: z.boolean(),
  profile_links: z.array(z.object({ label: z.string().min(1), url: HttpsUrl }).strict()).default([]),
}).strict();
export type Subject = z.infer<typeof Subject>;

// --- sources -------------------------------------------------------------------

export const SourceDocument = z.object({
  document_id: Slug,
  canonical_url: HttpsUrl,
  title: z.string().min(1),
  publisher: z.string().min(1),
  original_author: z.string().min(1), // a subject id or a plain name
  source_type: z.enum(SOURCE_TYPES),
  original_published_at: DateOrTimestamp.nullable(),
  original_date_precision: DatePrecision.nullable(),
  original_date_provenance: z.string().min(1), // e.g. "article:published_time meta"; "sitemap lastmod (uncertain)"
  original_date_uncertain: z.boolean(),
  discovered_at: Timestamp,
}).strict().superRefine((d, ctx) => {
  if (/sitemap|lastmod/i.test(d.original_date_provenance) && !d.original_date_uncertain) {
    ctx.addIssue({ code: "custom", message: "a date from a sitemap lastmod is flagged uncertain", path: ["original_date_uncertain"] });
  }
});
export type SourceDocument = z.infer<typeof SourceDocument>;

// An immutable observed version of a document. The id is the sha256 of the
// normalised text. Refetching identical text adds a fetch event, never a new
// version; a later 404 never rewrites a version.
export const SourceVersion = z.object({
  snapshot_hash: Sha256,
  document_id: Slug,
  first_observed_at: Timestamp,
  observed_via: z.enum(["live", "archive"]),
  archive_url: HttpsUrl.nullable(),     // when observed_via = archive
  archive_captured_at: Timestamp.nullable(),
  access_state: z.enum(ACCESS_STATES),
  context_completeness: z.enum(["complete", "partial", "unknown"]),
  parser_version: z.string().min(1),
  normalization_version: z.string().min(1),
  chars: z.number().int().nonnegative(),
  public_excerpt_policy: z.object({ max_words: z.number().int().positive().max(MAX_EXCERPT_WORDS) }).strict(),
  private_retained: z.boolean(),        // full text kept in private storage; a hash alone cannot reconstruct a source
}).strict().superRefine((v, ctx) => {
  if (v.observed_via === "archive" && (!v.archive_url || !v.archive_captured_at)) ctx.addIssue({ code: "custom", message: "an archived version names its archive URL and capture time", path: ["archive_url"] });
  if (v.access_state === "public_preview" && v.context_completeness === "complete") ctx.addIssue({ code: "custom", message: "a paywall preview is never complete context", path: ["context_completeness"] });
});
export type SourceVersion = z.infer<typeof SourceVersion>;

export const FetchEvent = z.object({
  fetch_event_id: Slug,
  document_id: Slug,
  url: HttpsUrl,
  attempted_at: Timestamp,
  retrieved_at: Timestamp.nullable(),
  http_status: z.number().int().nullable(),
  access_state: z.enum(ACCESS_STATES),
  observed_modified_at: DateOrTimestamp.nullable(),
  content_type: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  final_host: z.string().nullable(),
  snapshot_hash: Sha256.nullable(),
  error: z.string().max(400).nullable(),
}).strict();
export type FetchEvent = z.infer<typeof FetchEvent>;

// --- statements ----------------------------------------------------------------

// Where a quotation sits in one observed version. The exact quotation and its
// surrounding context are private, keyed by quote_hash; the public record
// carries a short excerpt, a locator, and the hashes that bind them.
export const SourceVersionReceipt = z.object({
  source_snapshot_id: Sha256,
  source_span: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict(),
  public_excerpt: PublicExcerpt,
  excerpt_locator: z.string().min(1).max(200),
  quote_hash: Sha256,
  quote_verification: z.object({
    status: z.enum(["exact", "normalized", "failed"]),
    normalization_version: z.string().min(1),
    verified_at: Timestamp,
    excerpt_in_quote: z.boolean(),
  }).strict(),
}).strict().refine((r) => r.source_span.end > r.source_span.start, "the span ends after it starts");
export type SourceVersionReceipt = z.infer<typeof SourceVersionReceipt>;

export const Occurrence = z.object({
  id: Slug,
  subject_id: SubjectId,
  document_id: Slug,
  attributed_speaker: z.string().min(1), // the subject id when the subject said it
  endorsement_status: z.enum(ENDORSEMENTS),
  statement_date: PartialDate,
  statement_date_precision: DatePrecision,
  extraction_run: z.string().min(1),
  claim_ids: z.array(Slug).min(1),
  source_version_receipts: z.array(SourceVersionReceipt).min(1),
  continuity: z.object({ status: z.enum(["single", "continued", "ambiguous"]), note: z.string().max(400).nullable() }).strict(),
}).strict();
export type Occurrence = z.infer<typeof Occurrence>;

// --- claims ---------------------------------------------------------------------

export const FinancialScope = z.object({
  company: z.string().min(1),
  metric: z.string().min(1),                // revenue, annualized_run_rate, operating_income, net_income, cash, operating_cash_flow, free_cash_flow, valuation, compute_commitments, gross_margin, ...
  currency: z.string().min(1).nullable(),
  units: z.string().min(1).nullable(),
  accounting_basis: z.enum(["gaap", "ifrs", "non_gaap", "company_reported", "estimate", "unknown"]),
  fiscal_or_calendar: z.enum(["fiscal", "calendar", "unknown"]),
  period_start: PartialDate.nullable(),
  period_end: PartialDate.nullable(),
  stock_or_flow: z.enum(["stock", "flow"]),
  annualized_or_realized: z.enum(["annualized", "realized", "not_applicable"]),
  gross_or_net: z.enum(["gross", "net", "not_applicable"]),
}).strict();
export type FinancialScope = z.infer<typeof FinancialScope>;

export const Condition = z.object({ text: z.string().min(1).max(400), type: z.enum(CONDITION_TYPES), from_source: z.boolean() }).strict();

export const ClaimRevision = z.object({
  claim_id: Slug,
  revision: z.number().int().positive(),
  subject_id: SubjectId,
  occurrence_ids: z.array(Slug).min(1),
  normalized_proposition: z.string().min(1).max(600),
  kind: z.enum(CLAIM_KINDS),
  target: z.string().min(1).max(200),             // the system, company, or phenomenon
  target_version: z.string().max(120).nullable(), // e.g. "GPT-5"
  quantifier: z.string().max(120).nullable(),     // e.g. "at least one", "most", "any"
  modality: z.enum(MODALITIES),
  conditions: z.array(Condition),
  original_horizon_text: z.string().max(200).nullable(), // as written; null when the speaker gave none
  original_threshold: z.string().max(200).nullable(),
  metric_scope: FinancialScope.nullable(),
  topic_tags: z.array(Slug).min(1),
  // The model providers this claim is about. Their models review it, so the
  // conflict is shown beside the assessment.
  concerns_providers: z.array(Provider),
  relation_to_prior_claim: z.object({ claim_id: Slug, relation: z.enum(RELATIONS_TO_PRIOR) }).strict().nullable(),
  revision_reason: z.string().max(400).nullable(),  // null on revision 1
  created_at: Timestamp,
  content_hash: Sha256,
}).strict().superRefine((c, ctx) => {
  if (c.kind === "conditional_forecast" && !c.conditions.some((x) => x.type === "antecedent")) {
    ctx.addIssue({ code: "custom", message: "a conditional forecast keeps its antecedent", path: ["conditions"] });
  }
  if (c.revision === 1 && c.revision_reason) ctx.addIssue({ code: "custom", message: "revision 1 has no revision reason", path: ["revision_reason"] });
  if (c.revision > 1 && !c.revision_reason) ctx.addIssue({ code: "custom", message: "a later revision says why", path: ["revision_reason"] });
});
export type ClaimRevision = z.infer<typeof ClaimRevision>;

// --- resolution contracts --------------------------------------------------------

export const Interval = z.object({ start: PartialDate.nullable(), end: PartialDate.nullable(), precision: DatePrecision }).strict()
  .refine((i) => !i.start || !i.end || earliestDay(i.start) <= latestDay(i.end), "an interval starts before it ends");

export const ResolutionContract = z.object({
  claim_id: Slug,
  version: z.number().int().positive(),
  claim_revision_ref: Ref,
  assessment_axis: z.enum(AXES),
  explicit_source_elements: z.array(z.string().min(1).max(300)),   // what the speaker actually committed to
  evaluator_interpretation: z.array(z.string().min(1).max(400)),   // what we added to make it testable, labelled as ours
  support_condition: z.string().min(1).max(600),
  contradiction_condition: z.string().min(1).max(600),
  measurement_requirements: z.string().max(600).nullable(),
  source_requirements: z.string().max(600).nullable(),
  metric_scope: FinancialScope.nullable(),
  original_horizon: z.string().max(200).nullable(),
  horizon_interval: Interval.nullable(),                            // only when the speaker gave a horizon
  target_period: Interval.nullable(),                               // for observations: the period described
  condition_status: z.enum(CONDITION_STATUSES),
  early_resolution_rule: z.string().max(400).nullable(),
  interpretation_determines_result: z.boolean(),
  // A firm claim that names no measure is scored on the plain reading an
  // informed reader would take, stated in evaluator_interpretation and shown
  // on the page (policy .6). Absent means false.
  plain_reading: z.boolean().optional(),
  ambiguity_flags: z.array(z.string().min(1).max(200)),
  retrospective_or_prospective: z.enum(["retrospective", "prospective"]),
  outcome_known_at_freeze: z.boolean(), // the drafter's declaration: was the outcome already public when the contract froze?
  written_at: Timestamp,
  frozen_at: Timestamp,
  policy_version: z.string().min(1),
  content_hash: Sha256,
}).strict().superRefine((k, ctx) => {
  if (k.assessment_axis === "forecast_outcome" && k.original_horizon && !k.horizon_interval) {
    ctx.addIssue({ code: "custom", message: "a stated horizon is recorded as an interval", path: ["horizon_interval"] });
  }
  if (!k.original_horizon && k.horizon_interval) {
    ctx.addIssue({ code: "custom", message: "no deadline is inferred: a horizon interval needs a horizon the speaker stated", path: ["horizon_interval"] });
  }
  if (k.assessment_axis === "historical_observation" && !k.target_period) {
    ctx.addIssue({ code: "custom", message: "an observation is assessed about the period it describes", path: ["target_period"] });
  }
  if (k.frozen_at < k.written_at) ctx.addIssue({ code: "custom", message: "frozen after written", path: ["frozen_at"] });
});
export type ResolutionContract = z.infer<typeof ResolutionContract>;

// --- evidence --------------------------------------------------------------------

export const EvidenceItem = z.object({
  id: Slug,
  // Only evidence_of_outcome can support or contradict a claim. Evidence of the
  // statement proves what was said, never that it was true; evidence of the
  // condition shows whether a conditional's antecedent happened.
  role: z.enum(["evidence_of_outcome", "evidence_of_condition", "evidence_of_statement", "context"]),
  document_id: Slug,
  source_snapshot_id: Sha256,
  publisher: z.string().min(1),
  source_type: z.enum(EVIDENCE_SOURCE_TYPES),
  url: HttpsUrl,
  locator: z.string().min(1).max(200),
  receipt: z.object({ public_excerpt: PublicExcerpt, quote_hash: Sha256, verified: z.enum(["exact", "normalized"]) }).strict(),
  event_date: PartialDate,         // when the thing the evidence describes happened
  available_at: DateOrTimestamp,   // when the evidence became public
  retrieved_at: Timestamp,
  relation: z.enum(EVIDENCE_RELATIONS),
  explanation: z.string().min(1).max(600),
  metric_scope: FinancialScope.nullable(),
  audited: z.boolean().nullable(),  // financial figures: audited or not; null when not financial
  derived: z.object({ inputs: z.array(z.string()), formula: z.string(), rounding: z.string() }).strict().nullable(),
}).strict();
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const EvidencePacket = z.object({
  packet_id: Slug,
  claim_revision_ref: Ref,
  contract_ref: Ref,
  evaluation_as_of: PartialDate,
  search_record: z.object({
    queries: z.array(z.string().min(1).max(300)),
    sources_considered: z.array(z.object({ url: HttpsUrl, used: z.boolean(), why: z.string().max(300) }).strict()),
    performed_at: Timestamp,
  }).strict(),
  evidence_items: z.array(EvidenceItem),
  material_counterevidence: z.array(Slug),
  unresolved_gaps: z.array(z.string().min(1).max(400)),
  packet_hash: Sha256,
}).strict();
export type EvidencePacket = z.infer<typeof EvidencePacket>;

// --- reviews ---------------------------------------------------------------------

// Token usage as the provider reported it. Unknown is null, never zero.
export const Usage = z.object({
  input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().nullable(), reasoning_tokens: z.number().int().nonnegative().nullable(),
}).strict();

// What one reviewer returns about one frozen case. Bounded text only.
export const ReviewOutput = z.object({
  attribution: z.object({ speaker_is_subject: z.boolean(), endorsed: z.boolean(), note: Bounded }).strict(),
  semantics: z.object({ proposition_faithful: z.boolean(), conditions_preserved: z.boolean(), kind_correct: z.boolean(), proposed_kind: z.enum(CLAIM_KINDS), note: Bounded }).strict(),
  contract: z.object({ fair_to_speaker: z.boolean(), interpretation_determines_result: z.boolean(), note: Bounded }).strict(),
  evidence: z.array(z.object({ id: Slug, fits: z.boolean(), relation: z.enum(EVIDENCE_RELATIONS), note: Bounded }).strict()),
  counterevidence_considered: z.boolean(),
  axis: z.enum(AXES),
  horizon_state: z.enum(HORIZON_STATES),
  outcome: z.enum(OUTCOMES),
  rationale: Bounded,
  abstain: z.boolean(),
  abstain_reason: Bounded.nullable(),
}).strict();
export type ReviewOutput = z.infer<typeof ReviewOutput>;

// What the final-text verifier returns about the composed public case.
export const FinalTextOutput = z.object({
  excerpt_matches: z.boolean(),
  proposition_faithful: z.boolean(),
  conditions_shown: z.boolean(),
  rationale_supported_by_evidence: z.boolean(),
  outcome_matches_reviews: z.boolean(),
  citations_correct: z.boolean(),
  overclaims: z.array(Bounded),
  verdict: z.enum(["pass", "fail"]),
  note: Bounded,
}).strict();
export type FinalTextOutput = z.infer<typeof FinalTextOutput>;

// Reviews and final-text checks of several claims in one call (policy .7).
// Each claim still gets its own answer, bound to its own case digest.
export const BatchReviewOutput = z.object({ reviews: z.array(ReviewOutput.extend({ claim_id: Slug }).strict()) }).strict();
export type BatchReviewOutput = z.infer<typeof BatchReviewOutput>;
export const BatchFinalOutput = z.object({ checks: z.array(FinalTextOutput.extend({ claim_id: Slug }).strict()) }).strict();
export type BatchFinalOutput = z.infer<typeof BatchFinalOutput>;

// What one provider returns when it makes probable calls (docs/adr/0006): the
// looser question a reasonable reader would answer about a claim the strict
// review could not settle. It never changes an assessment.
export const PROBABLE_CALLS = ["probably_right", "probably_wrong", "too_early"] as const;
export const BatchProbableOutput = z.object({ calls: z.array(z.object({ claim_id: Slug, call: z.enum(PROBABLE_CALLS), reason: Bounded }).strict()) }).strict();
export type BatchProbableOutput = z.infer<typeof BatchProbableOutput>;

// What one provider returns when it screens one post's claims (policy .7).
export const ScreenEntry = z.object({
  claim_id: Slug,
  speaker_is_subject: z.boolean(), endorsed: z.boolean(), proposition_faithful: z.boolean(),
  kind_correct: z.boolean(), proposed_kind: z.enum(CLAIM_KINDS),
  checkable: z.boolean(),
  reason: z.enum(UNCHECKABLE_REASONS).nullable(),   // set when not checkable
  test: z.string().max(400).nullable(),              // set when checkable: what public evidence would settle it
  timing: z.enum(CHECK_TIMING).nullable(),           // set when checkable
  note: Bounded,
}).strict();
export type ScreenEntry = z.infer<typeof ScreenEntry>;
export const ScreenOutput = z.object({ entries: z.array(ScreenEntry) }).strict();
export type ScreenOutput = z.infer<typeof ScreenOutput>;

export const ReviewRun = z.object({
  run_id: Slug,
  kind: z.enum(["assessment_review", "final_text_verification", "dispute_review", "screen", "batch_review", "batch_final_text", "batch_probable"]),
  provider: Provider,
  model_requested: z.string().min(1),
  model_returned: z.string().nullable(),
  via: z.enum(["api", "cli-login", "none"]),
  prompt_version: z.string().min(1),
  prompt_hash: Sha256,
  rubric_version: z.string().min(1),
  input_hashes: z.record(z.string(), Sha256),
  started_at: Timestamp,
  completed_at: Timestamp.nullable(),
  status: z.enum(["ok", "error", "malformed", "timeout", "unavailable", "budget"]),
  output: z.union([ReviewOutput, FinalTextOutput, ScreenOutput, BatchReviewOutput, BatchFinalOutput, BatchProbableOutput]).nullable(),
  error: z.string().max(600).nullable(),
  usage: Usage.nullable(),     // unknown is null, never zero
  cost_usd: z.string().regex(/^\d+(\.\d+)?$/).nullable(), // decimal string; unknown is null, never zero
}).strict();
export type ReviewRun = z.infer<typeof ReviewRun>;

// --- assessments -------------------------------------------------------------------

// The reader-visible case. Its canonical hash is what the final-text verifier
// checked and what the gate binds; any edit after that invalidates the pass.
export const PublicPayload = z.object({
  claim_id: Slug,
  subject_id: SubjectId,
  normalized_proposition: z.string().min(1),
  kind: z.enum(CLAIM_KINDS),
  conditions: z.array(z.string()),
  original_horizon_text: z.string().nullable(),
  statement: z.object({ excerpt: PublicExcerpt, locator: z.string(), url: HttpsUrl, date: PartialDate, document_title: z.string(), observed_at: Timestamp }).strict(),
  criteria: z.object({ from_speaker: z.array(z.string()), our_interpretation: z.array(z.string()), support_condition: z.string(), contradiction_condition: z.string() }).strict(),
  axis: z.enum(AXES),
  outcome: z.enum(OUTCOMES),
  horizon_state: z.enum(HORIZON_STATES),
  evaluation_as_of: PartialDate,
  rationale: z.string().min(1).max(1600),
  limitations: z.array(z.string().max(400)),
  evidence: z.array(z.object({ id: Slug, relation: z.enum(EVIDENCE_RELATIONS), excerpt: PublicExcerpt, locator: z.string(), url: HttpsUrl, publisher: z.string(), event_date: PartialDate, available_at: DateOrTimestamp, explanation: z.string() }).strict()),
  what_would_resolve: z.string().max(600).nullable(),
  retrospective: z.boolean(),
  plain_reading: z.boolean().optional(), // scored on a plain reading of words that name no measure
  uncheckable: z.array(z.enum(UNCHECKABLE_REASONS)).optional(), // screened out: the reasons both providers gave
}).strict();
export type PublicPayload = z.infer<typeof PublicPayload>;

export const Assessment = z.object({
  assessment_id: Slug,
  claim_revision_ref: Ref,
  contract_ref: Ref,
  packet_ref: z.object({ id: Slug, content_hash: Sha256 }).strict(),
  axis: z.enum(AXES),
  outcome: z.enum(OUTCOMES),
  horizon_state: z.enum(HORIZON_STATES),
  evaluation_as_of: PartialDate,
  target_period: Interval.nullable(),
  public_rationale: z.string().min(1).max(1600),
  evidence_ids: z.array(Slug),
  counterevidence_ids: z.array(Slug),
  limitations: z.array(z.string().max(400)),
  drafter: z.object({ provider: Provider, model: z.string().min(1) }).strict(),
  reviewer_run_ids: z.array(Slug),
  final_text_run_id: Slug.nullable(),
  policy_version: z.string().min(1),
  public_payload: PublicPayload,
  public_payload_hash: Sha256,
  supersedes_assessment_id: Slug.nullable(),
  next_review_due_at: PartialDate.nullable(),
  // When a forecast is settled before its deadline: which evidence item is the
  // event, when it happened, and how it meets the contract's early rule.
  conclusive_event: z.object({ evidence_id: Slug, event_date: PartialDate, meets_rule: z.string().min(1).max(400) }).strict().nullable(),
  recorded_at: Timestamp,
}).strict().superRefine((a, ctx) => {
  if (!AXES.includes(a.axis)) return;
  if (!HORIZON_STATES_FOR_AXIS[a.axis].includes(a.horizon_state)) ctx.addIssue({ code: "custom", message: `horizon state ${a.horizon_state} does not apply to axis ${a.axis}`, path: ["horizon_state"] });
  if (a.axis === "not_applicable" && a.outcome !== "not_adjudicable") ctx.addIssue({ code: "custom", message: "an ungraded axis records not_adjudicable", path: ["outcome"] });
  if (a.public_payload.outcome !== a.outcome || a.public_payload.axis !== a.axis || a.public_payload.horizon_state !== a.horizon_state) {
    ctx.addIssue({ code: "custom", message: "the public payload states the same axis, outcome, and horizon as the assessment", path: ["public_payload"] });
  }
});
export type Assessment = z.infer<typeof Assessment>;

// --- events, invalidations, disputes ------------------------------------------------

export const Event = z.object({
  event_id: Slug,
  type: z.enum(EVENT_TYPES),
  claim_id: Slug.nullable(),
  claim_revision: z.number().int().positive().nullable(),
  assessment_id: Slug.nullable(),
  recorded_at: Timestamp,
  effective_at: DateOrTimestamp.nullable(),
  actor: z.string().min(1),           // a run id, "editor", or "gate"
  reason: z.string().min(1).max(600),
  held_reason: z.enum(HELD_REASONS).nullable(),
  predecessor_event_id: Slug.nullable(),
  release_id: z.string().nullable(),
}).strict().superRefine((e, ctx) => {
  if (e.type === "held" && !e.held_reason) ctx.addIssue({ code: "custom", message: "a held event names its reason", path: ["held_reason"] });
});
export type Event = z.infer<typeof Event>;

// A verified problem with a published assessment. Only these can drive the
// invalidation-only release path, and only with receipts a check can re-run.
export const Invalidation = z.object({
  invalidation_id: Slug,
  assessment_id: Slug,
  action: z.enum(INVALIDATION_ACTIONS),
  reason_code: z.enum(INVALIDATION_REASONS),
  trigger: z.object({
    kind: z.enum(["integrity_check", "review_run"]),
    receipts: z.array(z.object({ kind: z.enum(["quote_check", "fetch_event", "review_run", "source_version"]), ref: z.string().min(1), detail: z.string().max(400) }).strict()).min(1),
  }).strict(),
  notice_template: z.enum(["under_review_neutral", "withdrawn_integrity"]),
  recorded_at: Timestamp,
}).strict().superRefine((i, ctx) => {
  if (i.action === "withdraw" && !WITHDRAW_REASONS.has(i.reason_code)) ctx.addIssue({ code: "custom", message: "withdrawal needs a confirmed integrity failure", path: ["reason_code"] });
  if (i.action === "withdraw" && i.notice_template !== "withdrawn_integrity") ctx.addIssue({ code: "custom", message: "a withdrawal uses the withdrawal notice", path: ["notice_template"] });
  if (i.action === "flag_under_review" && i.notice_template !== "under_review_neutral") ctx.addIssue({ code: "custom", message: "a flag uses the neutral notice", path: ["notice_template"] });
});
export type Invalidation = z.infer<typeof Invalidation>;

export const Dispute = z.object({
  dispute_id: Slug,
  issue_number: z.number().int().positive(),
  claim_id: Slug,
  assessment_id: Slug.nullable(),
  opened_at: Timestamp,
  disposition: z.enum(DISPOSITIONS),
  disposition_reason: z.string().max(800).nullable(),
  review_run_ids: z.array(Slug),
  invalidation_id: Slug.nullable(),
  resolved_at: Timestamp.nullable(),
}).strict();
export type Dispute = z.infer<typeof Dispute>;

// --- releases and activations --------------------------------------------------------

export const ActivationReceipt = z.object({
  activation_id: Slug,
  environment: z.enum(["production", "preview"]),
  kind: z.enum(["promote", "rollback", "invalidation"]),
  activated_at: Timestamp,
  release_id: z.string().min(1),
  release_digest: Sha256,
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  artifact_digest: Sha256,
  predecessor_activation_id: Slug.nullable(),
}).strict();
export type ActivationReceipt = z.infer<typeof ActivationReceipt>;

export const CurrentRelease = z.object({
  release_id: z.string().min(1),
  manifest_digest: Sha256,
  updated_at: Timestamp,
  predecessor_release_id: z.string().nullable(),
}).strict();
export type CurrentRelease = z.infer<typeof CurrentRelease>;

export const SCHEMA_REGISTRY = {
  Subject, SourceDocument, SourceVersion, FetchEvent, Occurrence, ClaimRevision, ResolutionContract, EvidencePacket,
  ReviewRun, Assessment, Event, Invalidation, Dispute, ActivationReceipt, CurrentRelease,
} as const;

// Re-exported so callers check axis/kind compatibility in one place.
export { AXES_FOR_KIND };
