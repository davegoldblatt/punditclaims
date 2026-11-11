// The controlled vocabulary and the rules that code enforces. The editorial
// prose lives in docs/policy.md; the machine-readable copy that validation
// checks against is policy/policy.yaml. tests/policy.test.ts keeps all three in
// step: a word added here and not there fails the build.

export const POLICY_VERSION = "2026-10-28.7";
export const SCHEMA_VERSION = 1;

// The people this deployment covers come from config/register.yaml. Anyone
// else can be a source or a quoted third party, never a subject. Adding one is
// a configuration change, made deliberately, never a data edit.
import { CONFIG } from "./config.ts";
export const SUBJECT_IDS = CONFIG.subjects.map((s) => s.id) as [string, ...string[]];
export type SubjectId = string;

export const CLAIM_KINDS = ["observation", "forecast", "conditional_forecast", "causal", "normative", "rhetoric"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const AXES = ["historical_observation", "forecast_outcome", "causal_assessment", "not_applicable"] as const;
export type Axis = (typeof AXES)[number];

export const OUTCOMES = ["supported", "contradicted", "mixed", "unresolved", "not_adjudicable"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const HORIZON_STATES = ["not_applicable", "open_horizon", "not_due", "elapsed", "conclusive_event"] as const;
export type HorizonState = (typeof HORIZON_STATES)[number];

export const WORKFLOW_STATES = ["candidate", "ready_for_review", "held", "published", "withdrawn"] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const HELD_REASONS = [
  "source_unavailable", "source_partial", "attribution_uncertain", "quote_mismatch", "criteria_ambiguous",
  "evidence_incomplete", "semantic_disagreement", "assessment_disagreement", "verification_unavailable",
  "malformed_review", "stale_binding", "budget_exhausted", "disputed", "policy_mismatch",
] as const;
export type HeldReason = (typeof HELD_REASONS)[number];

export const EVENT_TYPES = [
  "source_discovered", "speaker_clarified", "speaker_revised", "speaker_retracted", "evidence_added",
  "assessment_published", "assessment_changed", "site_corrected", "assessment_withdrawn", "under_review_flagged",
  "held", "dispute_opened", "dispute_resolved",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Speaker behaviour and site behaviour never share a label.
export const SPEAKER_EVENTS: ReadonlySet<EventType> = new Set(["speaker_clarified", "speaker_revised", "speaker_retracted"]);
export const SITE_EVENTS: ReadonlySet<EventType> = new Set(["site_corrected", "assessment_withdrawn", "under_review_flagged", "assessment_changed", "assessment_published", "held"]);

export const ACCESS_STATES = ["full_public", "authorized_full", "public_preview", "blocked", "unavailable", "deleted"] as const;
export type AccessState = (typeof ACCESS_STATES)[number];
// Only these let a source version stand as the full original context.
export const FULL_ACCESS: ReadonlySet<AccessState> = new Set(["full_public", "authorized_full"]);

export const ENDORSEMENTS = ["endorsed", "quoted_other", "reported_speech", "ambiguous"] as const;
export type Endorsement = (typeof ENDORSEMENTS)[number];

export const EVIDENCE_RELATIONS = ["supports", "contradicts", "context"] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const EVIDENCE_SOURCE_TYPES = [
  "filing", "company_disclosure", "official_statistics", "independent_measurement", "peer_reviewed", "preprint",
  "benchmark", "demonstration", "news_report", "secondary_summary", "author_statement",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export const SOURCE_TYPES = ["newsletter", "blog", "filing", "company_page", "paper", "preprint", "news", "dataset", "transcript", "other"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const DATE_PRECISIONS = ["datetime", "day", "month", "quarter", "year"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const MODALITIES = ["will", "will_not", "likely", "unlikely", "may", "could", "should", "must", "is", "was"] as const;
// Hedged and probabilistic language. A single outcome does not grade a
// probability or a possibility, so in this policy version these forecasts are
// recorded and shown with what happened, but not scored.
export const HEDGED_MODALITIES: ReadonlySet<string> = new Set(["may", "could", "likely", "unlikely"]);
export const CONDITION_TYPES = ["antecedent", "scope", "qualifier"] as const;
export const CONDITION_STATUSES = ["not_applicable", "met", "not_met", "unknown"] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const INVALIDATION_ACTIONS = ["flag_under_review", "withdraw"] as const;
export type InvalidationAction = (typeof INVALIDATION_ACTIONS)[number];
// Reasons a published assessment may be flagged or withdrawn without a new verdict.
// A raw dispute or an unverified allegation is not on this list.
export const INVALIDATION_REASONS = [
  "attribution_failure", "quote_mismatch", "source_integrity_failure", "verified_material_counterevidence", "extraction_error",
] as const;
export type InvalidationReason = (typeof INVALIDATION_REASONS)[number];
// Withdrawal needs an integrity failure; material counterevidence only flags.
export const WITHDRAW_REASONS: ReadonlySet<InvalidationReason> = new Set(["attribution_failure", "quote_mismatch", "source_integrity_failure", "extraction_error"]);

export const DISPOSITIONS = ["upheld", "rejected", "under_review"] as const;

export const RELATIONS_TO_PRIOR = ["repeats", "revises", "narrows", "broadens", "retracts", "related"] as const;

// Which axes a kind of claim can be assessed on. Normative and rhetorical
// statements are recorded, attributed, and never scored.
export const AXES_FOR_KIND: Record<ClaimKind, readonly Axis[]> = {
  observation: ["historical_observation", "not_applicable"],
  forecast: ["forecast_outcome", "not_applicable"],
  conditional_forecast: ["forecast_outcome", "not_applicable"],
  causal: ["causal_assessment", "not_applicable"],
  normative: ["not_applicable"],
  rhetoric: ["not_applicable"],
};

// Why a claim cannot be checked against evidence (policy .7). Both providers
// screen every claim; a claim both find uncheckable is published as
// not_adjudicable with these reasons and no evidence search.
export const UNCHECKABLE_REASONS = ["value_judgment", "rhetoric", "probability_language", "no_plain_reading", "no_public_evidence"] as const;
export type UncheckableReason = (typeof UNCHECKABLE_REASONS)[number];
export const UNCHECKABLE_LABEL: Record<UncheckableReason, string> = {
  value_judgment: "a recommendation or a value judgment",
  rhetoric: "rhetoric that commits to nothing testable",
  probability_language: "stated as a chance or a possibility, or at medium or low confidence",
  no_plain_reading: "too vague to test: informed readers would test it in different ways and reach different answers",
  no_public_evidence: "about something no public evidence could show, such as a private intention or a counterfactual",
};
// When a checkable claim can be settled.
export const CHECK_TIMING = ["now", "not_due", "needs_event"] as const;

export const HORIZON_STATES_FOR_AXIS: Record<Axis, readonly HorizonState[]> = {
  historical_observation: ["not_applicable"],
  causal_assessment: ["not_applicable"],
  not_applicable: ["not_applicable"],
  forecast_outcome: ["open_horizon", "not_due", "elapsed", "conclusive_event"],
};

// Public wording. One place, so every surface says the same thing.
export const OUTCOME_LABEL: Record<Outcome, string> = {
  supported: "Supported",
  contradicted: "Contradicted",
  mixed: "Mixed",
  unresolved: "Unresolved",
  not_adjudicable: "Can’t be checked",
};
export const OUTCOME_DESCRIPTION: Record<Outcome, string> = {
  supported: "The evidence matches what they said.",
  contradicted: "The evidence goes against what they said.",
  mixed: "Part of it held up and part didn’t. The reasons below say which.",
  unresolved: "We checked, and the evidence so far doesn’t settle it.",
  not_adjudicable: "An opinion, a recommendation, or too vague to test. Listed, not scored.",
};
export const HORIZON_LABEL: Record<HorizonState, string> = {
  not_applicable: "No horizon",
  open_horizon: "No deadline stated",
  not_due: "Not yet due",
  elapsed: "Deadline passed",
  conclusive_event: "Settled before its deadline",
};
export const KIND_LABEL: Record<ClaimKind, string> = {
  observation: "Observation",
  forecast: "Forecast",
  conditional_forecast: "Conditional forecast",
  causal: "Causal claim",
  normative: "Recommendation or value judgment",
  rhetoric: "Rhetoric",
};
export const AXIS_LABEL: Record<Axis, string> = {
  historical_observation: "Was it true for the period described?",
  forecast_outcome: "Did the forecast come true?",
  causal_assessment: "Does the evidence support the cause?",
  not_applicable: "Not graded on evidence",
};
export const HELD_LABEL: Record<HeldReason, string> = {
  source_unavailable: "The source could not be read",
  source_partial: "Only part of the source could be read",
  attribution_uncertain: "Not sure who said it",
  quote_mismatch: "The quotation did not match the source",
  criteria_ambiguous: "The test may not be fair to their words",
  evidence_incomplete: "The evidence is incomplete",
  semantic_disagreement: "The AIs read the claim differently",
  assessment_disagreement: "The AIs reached different verdicts",
  verification_unavailable: "A check could not run",
  malformed_review: "A review came back unusable",
  stale_binding: "The text changed after it was checked",
  budget_exhausted: "We ran out of checking time",
  disputed: "A dispute is open",
  policy_mismatch: "It didn’t meet our rules",
};
export const EVENT_LABEL: Record<EventType, string> = {
  source_discovered: "Source discovered",
  speaker_clarified: "Speaker clarified",
  speaker_revised: "Speaker revised the claim",
  speaker_retracted: "Speaker retracted",
  evidence_added: "New evidence",
  assessment_published: "Published",
  assessment_changed: "Verdict changed",
  site_corrected: "Correction",
  assessment_withdrawn: "Withdrawn",
  under_review_flagged: "Under review",
  held: "Held back",
  dispute_opened: "Dispute opened",
  dispute_resolved: "Dispute resolved",
};

// Every claim shows the speaker's own words in full (owner decision,
// policy .5). One excerpt may run to this many words, enough for the
// complete statement in nearly every case.
export const MAX_EXCERPT_WORDS = 80;
// The per-source cap is off in this policy version (null). The check still
// exists so a deployment can turn it back on.
export const MAX_WORDS_PER_DOCUMENT: number | null = null;
export const MAX_SHARE_OF_DOCUMENT: number | null = null;
// Reviewer free text is bounded so a record cannot become a source dump.
export const MAX_REVIEW_TEXT = 1200;

export const COLLECTION_TARGET = { target: 40, floor: 20, per_subject_floor: 8 } as const;
