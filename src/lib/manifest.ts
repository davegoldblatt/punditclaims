// The release manifest: the one public dataset. Every page, count, search
// record, feed, export, and share image reads this and nothing else. It is
// built by scripts/release.ts from records that passed the gate, sealed with
// a digest over its canonical form, and selected by data/current-release.json.
import { z } from "zod";
import {
  ACCESS_STATES, AXES, CLAIM_KINDS, EVIDENCE_SOURCE_TYPES, DATE_PRECISIONS, EVENT_TYPES, HELD_REASONS, HORIZON_STATES, INVALIDATION_REASONS, OUTCOMES,
  PROVIDERS, RELATIONS_TO_PRIOR, SUBJECT_IDS,
} from "../policy.ts";
import { DateOrTimestamp, HttpsUrl, PartialDate, PublicExcerpt, PublicPayload, Sha256, Slug, Timestamp } from "../schema.ts";

const SubjectId = z.enum(SUBJECT_IDS);

export const PublicSubject = z.object({
  id: SubjectId,
  name: z.string(),
  identification: z.string(),
  identification_source: z.object({ title: z.string(), url: HttpsUrl }).strict(),
  profile_links: z.array(z.object({ label: z.string(), url: HttpsUrl }).strict()),
  windows: z.array(z.object({ id: z.string(), publication: z.string(), origin: HttpsUrl, from: PartialDate, to: PartialDate, basis: z.string() }).strict()),
}).strict();

export const PublicOccurrence = z.object({
  id: Slug,
  statement_date: PartialDate,
  statement_date_precision: z.enum(DATE_PRECISIONS),
  excerpt: PublicExcerpt,
  locator: z.string(),
  document: z.object({
    url: HttpsUrl, title: z.string(), publisher: z.string(),
    published_at: DateOrTimestamp.nullable(), date_uncertain: z.boolean(), date_provenance: z.string(),
  }).strict(),
  observed_at: Timestamp,           // when this version of the source was observed
  observed_via: z.enum(["live", "archive"]),
  archive_url: HttpsUrl.nullable(),
  access_state: z.enum(ACCESS_STATES),
  snapshot_hash: Sha256,
  receipts: z.number().int().positive(), // observed versions that carry this passage
}).strict();
export type PublicOccurrence = z.infer<typeof PublicOccurrence>;

export const Reviewer = z.object({ provider: z.enum(PROVIDERS), model: z.string(), run_id: Slug }).strict();

// One assessment as the public sees it. `status` is the site's standing for
// it in this release; old versions stay readable at their own address.
export const PublicAssessment = z.object({
  assessment_id: Slug,
  payload: PublicPayload,
  payload_hash: Sha256,
  policy_version: z.string(),
  recorded_at: Timestamp,
  drafter: z.object({ provider: z.enum(PROVIDERS), model: z.string() }).strict(),
  reviewers: z.array(Reviewer).length(2),
  final_text: Reviewer.nullable(), // null only for a screened-out claim, whose text code composed (policy .7)
  status: z.enum(["current", "under_review", "superseded", "withdrawn"]),
  notice: z.object({ kind: z.enum(["under_review_neutral", "withdrawn_integrity", "operational_stale"]), reason_code: z.enum(INVALIDATION_REASONS).nullable(), text: z.string(), since: Timestamp }).strict().nullable(),
  superseded_by: Slug.nullable(),
  // Structured facts about each evidence item, copied by code from the bound
  // packet: what kind of source it is, whether a figure is audited, and any
  // arithmetic. No prose is added after the final-text check.
  evidence_meta: z.array(z.object({
    id: Slug, source_type: z.enum(EVIDENCE_SOURCE_TYPES), audited: z.boolean().nullable(),
    derived: z.object({ inputs: z.array(z.string()), formula: z.string(), rounding: z.string() }).strict().nullable(),
    metric: z.object({ company: z.string(), metric: z.string(), currency: z.string().nullable(), units: z.string().nullable(), accounting_basis: z.string(), period_start: PartialDate.nullable(), period_end: PartialDate.nullable() }).strict().nullable(),
  }).strict()),
  public_from: Timestamp.nullable(),  // first production activation that carried it; null until activated
  public_until: Timestamp.nullable(),
}).strict();
export type PublicAssessment = z.infer<typeof PublicAssessment>;

export const PublicEvent = z.object({
  event_id: Slug,
  type: z.enum(EVENT_TYPES),
  claim_id: Slug.nullable(),
  subject_id: SubjectId.nullable(),
  assessment_id: Slug.nullable(),
  recorded_at: Timestamp,
  effective_at: DateOrTimestamp.nullable(),
  reason: z.string(),
  substantive: z.boolean(), // false for copy edits; the default sort ignores them
}).strict();
export type PublicEvent = z.infer<typeof PublicEvent>;

// A probable call and its confidence level (docs/adr/0006).
const Probable = z.object({
  call: z.enum(["probably_right", "probably_wrong"]), level: z.enum(["reasonable", "speculative"]),
  // Each agreeing provider's one-line reason, as it answered.
  reasons: z.array(z.object({ provider: z.enum(PROVIDERS), reason: z.string().max(1200) }).strict()).optional(),
}).strict();

export const PublicClaim = z.object({
  claim_id: Slug,
  subject_id: SubjectId,
  revision: z.number().int().positive(),
  content_hash: Sha256,
  normalized_proposition: z.string(),
  kind: z.enum(CLAIM_KINDS),
  target: z.string(),
  conditions: z.array(z.object({ text: z.string(), type: z.string(), from_source: z.boolean() }).strict()),
  original_horizon_text: z.string().nullable(),
  topic_tags: z.array(Slug),
  concerns_providers: z.array(z.enum(PROVIDERS)), // the claim is about a company whose models review it
  selection_stratum: z.string(),
  occurrences: z.array(PublicOccurrence).min(1),
  first_statement_date: PartialDate,
  related: z.array(z.object({ claim_id: Slug, relation: z.enum(RELATIONS_TO_PRIOR) }).strict()),
  current: PublicAssessment.nullable(),   // null only when the current assessment was withdrawn and nothing replaced it
  history: z.array(PublicAssessment),     // every earlier assessment, oldest first
  review: z.object({
    review_due: z.boolean(),
    triggers: z.array(z.string()),
    last_completed_review_at: Timestamp,
    next_review_due_at: PartialDate.nullable(),
    horizon_now: z.enum(HORIZON_STATES), // the horizon at the release's reference date; may differ from the assessment's
  }).strict(),
  event_ids: z.array(Slug),
  last_substantive_change_at: Timestamp,
  // A probable call (docs/adr/0006) on a claim the strict review left
  // unresolved, with its level. Absent when there is none. Never part of the assessment.
  probable: Probable.optional(),
}).strict();
export type PublicClaim = z.infer<typeof PublicClaim>;

export const HeldRecord = z.object({
  id: Slug,                    // a claim id or a candidate id
  subject_id: SubjectId,
  held_reason: z.enum(HELD_REASONS),
  since: Timestamp,
  detail: z.string().max(600), // written by code from a fixed template; never a model's allegation
  source: z.object({ url: HttpsUrl, title: z.string(), date: PartialDate.nullable() }).strict(),
  // Shown only when the quotation and attribution were verified; otherwise null.
  proposition: z.string().nullable(),
  // A probable call (docs/adr/0006) on a held claim whose words are not in doubt.
  probable: Probable.optional(),
  // The claim's kind, so a held claim's probable call can be split into
  // predictions and claims about the present or past.
  kind: z.enum(CLAIM_KINDS).optional(),
  // Their words, present only with a probable call (whose rule requires the
  // quote, the attribution, and our reading not to be in doubt).
  excerpt: z.string().optional(),
}).strict();
export type HeldRecord = z.infer<typeof HeldRecord>;

const CountMap = z.record(z.string(), z.number().int().nonnegative());
export const Counts = z.object({
  distinct_claims: z.number().int().nonnegative(),
  occurrences: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  withdrawn: z.number().int().nonnegative(),
  by_subject: CountMap,
  by_kind: CountMap,
  by_outcome: CountMap,
  by_horizon: CountMap,
  by_subject_outcome: z.record(z.string(), CountMap),
}).strict();
export type Counts = z.infer<typeof Counts>;

export const CoverageWindow = z.object({
  window_id: z.string(),
  subject_id: SubjectId,
  publication: z.string(),
  from: PartialDate,
  to: PartialDate,
  discovered: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  paywalled: z.number().int().nonnegative(),
  read_in_full: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  notes: z.array(z.string()),
}).strict();

export const ReleaseManifest = z.object({
  kind: z.literal("punditclaims-release"),
  release_id: z.string().regex(/^\d{8}T\d{6}Z-[0-9a-f]{12}$/),
  generated_at: Timestamp,
  reference_date: PartialDate,   // every "due", "elapsed", and "as of" on the site is computed from this, never from a visitor's clock
  source_cutoff: PartialDate,
  evaluation_cutoff: PartialDate,
  schema_version: z.number().int(),
  policy_version: z.string(),
  code_commit: z.string().regex(/^[0-9a-f]{40}$/),
  fixture: z.boolean(),
  predecessor_release_id: z.string().nullable(),
  subjects: z.array(PublicSubject).min(1),
  claims: z.array(PublicClaim),
  held: z.array(HeldRecord),
  events: z.array(PublicEvent),
  coverage: z.array(CoverageWindow),
  counts: Counts,
  invalidations_applied: z.array(Slug),
  regressions_open: z.array(z.string()),
  digest: Sha256,
}).strict();
export type ReleaseManifest = z.infer<typeof ReleaseManifest>;
