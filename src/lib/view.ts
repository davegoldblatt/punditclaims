// Derived views over the one release, for pages and exports. Pure functions
// of release data and the policy labels in src/policy.ts: no file access, no
// clock, no new facts. Wording that the policy does not define (provider
// names, access states, evidence relations, topic labels) lives here once.
import type { HeldRecord, PublicAssessment, PublicClaim, PublicEvent, PublicOccurrence, ReleaseManifest } from "./manifest.ts";
import type { PublicPayload } from "../schema.ts";
import { earliestDay } from "./dates.ts";
import {
  HORIZON_LABEL, OUTCOME_LABEL, SITE_EVENTS, SPEAKER_EVENTS, UNCHECKABLE_LABEL,
  type AccessState, type EventType, type EvidenceRelation, type HorizonState, type Provider, type UncheckableReason,
} from "../policy.ts";

export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

export const ACCESS_TEXT: Record<AccessState, string> = {
  full_public: "full text, public",
  authorized_full: "full text, read with authorized access",
  public_preview: "preview only; the full text was not readable",
  blocked: "access blocked",
  unavailable: "unavailable",
  deleted: "deleted at the source",
};

export const RELATION_TEXT: Record<EvidenceRelation, string> = {
  supports: "Supports the claim",
  contradicts: "Goes against the claim",
  context: "Context only",
};
export const RELATION_ORDER: EvidenceRelation[] = ["supports", "contradicts", "context"];

// Topic tags are slugs. Show them as words; a few acronyms stay upper case.
const ACRONYMS = new Set(["ai", "agi", "llm", "llms", "gpu", "gpus", "api", "rl", "ipo"]);
// American spelling on the page; the slugs stay as recorded.
const TOPIC_WORDS: Record<string, string> = { labour: "labor" };
export function topicLabel(slug: string): string {
  const s = slug.split("-").map((w) => TOPIC_WORDS[w] ?? w).map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w)).join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Dates stay as written. A timestamp shows its UTC day.
export const day = (d: string): string => (d.length > 10 && d.includes("T") ? d.slice(0, 10) : d);

// --- events ----------------------------------------------------------------

export type EventGroup = "speaker" | "site" | "evidence" | "dispute" | "source";
export const EVENT_GROUP_LABEL: Record<EventGroup, string> = {
  speaker: "By the speaker",
  site: "By us",
  evidence: "New evidence",
  dispute: "Reader dispute",
  source: "Source",
};
export function eventGroup(t: EventType): EventGroup {
  if (SPEAKER_EVENTS.has(t)) return "speaker";
  if (SITE_EVENTS.has(t)) return "site";
  if (t === "evidence_added") return "evidence";
  if (t === "dispute_opened" || t === "dispute_resolved") return "dispute";
  return "source";
}

// Newest first; ties by id so the order is stable across builds.
export const byNewest = (a: PublicEvent, b: PublicEvent): number =>
  b.recorded_at.localeCompare(a.recorded_at) || b.event_id.localeCompare(a.event_id);

// --- claims and assessments ----------------------------------------------------

export type Standing = "current" | "under_review" | "withdrawn";
export function standingOf(c: PublicClaim): Standing {
  if (!c.current || c.current.status === "withdrawn") return "withdrawn";
  return c.current.status === "under_review" ? "under_review" : "current";
}

// Every assessment version of a claim, oldest first, each id once.
export function versionsOf(c: PublicClaim): PublicAssessment[] {
  const out: PublicAssessment[] = [];
  for (const a of [...c.history, ...(c.current ? [c.current] : [])]) {
    const i = out.findIndex((x) => x.assessment_id === a.assessment_id);
    if (i >= 0) out[i] = a; else out.push(a);
  }
  return out;
}

// The assessment a claim page shows: the current one, or the withdrawn one
// under its tombstone when nothing replaced it.
export function shownAssessment(c: PublicClaim): PublicAssessment | null {
  if (c.current) return c.current;
  const v = versionsOf(c);
  return [...v].reverse().find((a) => a.status === "withdrawn") ?? v.at(-1) ?? null;
}

export const VERSION_STATUS_TEXT: Record<PublicAssessment["status"], string> = {
  current: "Current",
  under_review: "Current, under review",
  superseded: "Replaced",
  withdrawn: "Withdrawn",
};

// The label that stands for a claim's assessment wherever it is summarised
// (rows, share images, exports). A withdrawn assessment never shows its old
// outcome as if it were current.
export function assessmentLabel(c: PublicClaim): string {
  if (standingOf(c) === "withdrawn") return "Assessment withdrawn";
  return OUTCOME_LABEL[c.current!.payload.outcome];
}

// A screened-out assessment (policy .7): both providers found that public
// evidence could not settle the claim, so it was not checked against evidence,
// and code, not a model, composed its text from the two screens.
export const isScreenedOut = (a: PublicAssessment | null | undefined): boolean => !!a?.payload.uncheckable?.length;

// The screens' reasons as sentences a reader can follow.
export function uncheckableReasons(a: PublicAssessment): string[] {
  return (a.payload.uncheckable ?? []).map((r: UncheckableReason) => {
    const t = UNCHECKABLE_LABEL[r];
    return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  });
}

export const horizonNowLabel = (c: PublicClaim): string => HORIZON_LABEL[c.review.horizon_now];
export const isOpenHorizon = (h: HorizonState): boolean => h === "open_horizon" || h === "not_due";

// The statement occurrence that the assessment's quoted excerpt came from.
// The payload does not name it, so match on excerpt and date, then on URL.
export function statementOccurrence(c: PublicClaim, p: PublicPayload): PublicOccurrence | null {
  return c.occurrences.find((o) => o.excerpt === p.statement.excerpt && o.statement_date === p.statement.date)
    ?? c.occurrences.find((o) => o.document.url === p.statement.url)
    ?? null;
}

// One material qualification for a register row: an antecedent first, then
// the first stated limitation, then any other condition.
export function qualification(c: PublicClaim): { label: string; text: string } | null {
  const ante = c.conditions.find((x) => x.type === "antecedent");
  if (ante) return { label: "Only if", text: ante.text };
  const lim = c.current?.payload.limitations[0];
  if (lim) return { label: "Limitation", text: lim };
  const other = c.conditions[0];
  if (other) return { label: other.type === "scope" ? "Scope" : "Qualifier", text: other.text };
  return null;
}

// What settled a claim, in one line per side: the first evidence item that
// supports (or goes against) it, with its reviewed explanation, publisher, and
// date. A mixed claim gets what held and what did not. Nothing for a claim the
// evidence did not settle, and nothing for a conditional forecast: the public
// record does not say which items are about its condition rather than its
// outcome, so the claim page shows the evidence in full instead.
export type Settler = { label: string; text: string; publisher: string; url: string; date: string };
export function whatHappened(c: PublicClaim): Settler[] {
  const p = c.current?.payload;
  if (!p || !["supported", "contradicted", "mixed"].includes(p.outcome) || c.kind === "conditional_forecast") return [];
  const pick = (rel: "supports" | "contradicts") => p.evidence.find((e) => e.relation === rel);
  const line = (label: string, e: (typeof p.evidence)[number] | undefined): Settler[] => (e ? [{ label, text: e.explanation, publisher: e.publisher, url: e.url, date: e.event_date }] : []);
  // The label names what the evidence did (Dave 2026-10-31: "what supported it",
  // "what contradicted it"), so a reader knows which way it cuts before reading.
  if (p.outcome === "supported") return line("What supported it", pick("supports"));
  if (p.outcome === "contradicted") return line("What contradicted it", pick("contradicts"));
  return [...line("What supported part of it", pick("supports")), ...line("What contradicted part of it", pick("contradicts"))];
}

// --- ordering ------------------------------------------------------------------

export const saidKey = (c: PublicClaim): string => earliestDay(c.first_statement_date);
// Register default: original statement date, newest first; ties by id.
export const bySaid = (a: PublicClaim, b: PublicClaim): number =>
  saidKey(b).localeCompare(saidKey(a)) || a.claim_id.localeCompare(b.claim_id);

// --- addresses, citations, disputes -----------------------------------------

export const claimPath = (id: string): string => `/claims/${id}`;
export const versionPath = (id: string, aid: string): string => `/claims/${id}/v/${aid}`;
export const personPath = (id: string): string => `/people/${id}`;

// Every assessment has one permanent address. The assessment a claim page
// shows is read on that page, at #assessment-<id>; every other version has a
// page of its own. When the shown one is later replaced, the claim page keeps
// the same anchor on its entry in the history, which links to the new page.
// This keeps the build to one file per claim (Cloudflare Pages allows 20,000).
export const assessmentAnchor = (aid: string): string => `assessment-${aid}`;
export const hasVersionPage = (c: PublicClaim, aid: string): boolean => shownAssessment(c)?.assessment_id !== aid;
export const assessmentPath = (c: PublicClaim, aid: string): string =>
  hasVersionPage(c, aid) ? versionPath(c.claim_id, aid) : `${claimPath(c.claim_id)}#${assessmentAnchor(aid)}`;

export function citation(m: ReleaseManifest, c: PublicClaim, a: PublicAssessment | null, origin: string, personName: string): string {
  const head = `Pundit Claims, claim ${c.claim_id} (${personName}, first said ${c.first_statement_date})`;
  if (!a) return `${head}, no assessment. Release ${m.release_id}. ${origin}${claimPath(c.claim_id)}`;
  const state = a.status === "withdrawn"
    ? `withdrawn${a.notice ? ` on ${day(a.notice.since)}` : ""}`
    : isScreenedOut(a)
      ? `${OUTCOME_LABEL[a.payload.outcome]}, not checked against evidence`
      : `${OUTCOME_LABEL[a.payload.outcome]}, evidence as of ${a.payload.evaluation_as_of}`;
  return `${head}, assessment ${a.assessment_id}: ${state}. Release ${m.release_id}. ${origin}${assessmentPath(c, a.assessment_id)}`;
}

// A GitHub issue-form link with the claim and assessment filled in. The
// query keys match the field ids in .github/ISSUE_TEMPLATE/dispute.yml.
export function disputeUrl(repo: string, claimId: string, assessmentId: string | null): string {
  const q = new URLSearchParams({ template: "dispute.yml", title: `Dispute: ${claimId}`, claim_id: claimId, assessment_id: assessmentId ?? "none" });
  return `${repo}/issues/new?${q.toString()}`;
}

// --- counts --------------------------------------------------------------------

// Count live claims by a value. Used for derived counts the manifest does not
// carry (topics, and per-person kind or horizon). scripts/check-dist.ts
// recomputes each one independently.
export function tally<T extends string>(claims: PublicClaim[], key: (c: PublicClaim) => T | T[]): Map<T, number> {
  const out = new Map<T, number>();
  for (const c of claims) for (const v of ([] as T[]).concat(key(c))) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

export function sortedTopics(claims: PublicClaim[]): [string, number][] {
  return [...tally(claims, (c) => c.topic_tags)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const heldBySubject = (held: HeldRecord[], s: string): HeldRecord[] => held.filter((h) => h.subject_id === s);

// --- plain words for internal reasons -----------------------------------------

// A held record's reason in plain words. The gate writes its detail for the
// pipeline (field names, provider ids); readers get one sentence that says
// what went wrong. Unknown details fall back to the policy's reason label.
const FINAL_TEXT_FIELD: Record<string, string> = {
  citations_correct: "a cited source didn’t say what the write-up said",
  rationale_supported_by_evidence: "the write-up said more than the evidence showed",
  proposition_faithful: "our summary didn’t match their words",
  excerpt_matches: "the quote didn’t match the source",
  conditions_shown: "a condition they stated was left out",
  outcome_matches_reviews: "the verdict didn’t match the reviews",
};
export function plainHeld(detail: string | null | undefined, fallback: string): string {
  const d = detail ?? "";
  if (/final-text check failed/.test(d)) {
    const fields = Object.keys(FINAL_TEXT_FIELD).filter((k) => d.includes(k)).map((k) => FINAL_TEXT_FIELD[k]);
    return fields.length ? `The final check failed: ${fields.join(", and ")}.` : "The final check of the write-up failed.";
  }
  const rules: [RegExp, string][] = [
    [/screen reads the claim differently/, "One of the AIs read the claim differently from our summary."],
    [/review reads the claim differently|puts a \w+ claim on the \w+ axis/, "The two reviewers read the claim differently."],
    [/criteria unfair/, "A reviewer said our test wasn’t fair to what was actually said."],
    [/review abstained/, "A reviewer declined to make a call."],
    [/screen finds the claim checkable/, "One AI thought this could be checked, so it needs a full check first."],
    [/The two reviews differ/, "The two reviewers reached different verdicts."],
    [/Both reviews say/, "Both reviewers disagreed with the draft’s verdict."],
    [/does not accept \S+ as/, "A reviewer didn’t accept one of the pieces of evidence."],
    [/doubts the attribution/, "One AI wasn’t sure who said it."],
    [/hedged language is not scored/, "The claim is hedged, so it isn’t scored."],
    [/cannot be assessed on the \w+ axis|does not apply to axis/, "The check used the wrong kind of test for this claim."],
    [/is not inside the period described/, "A piece of evidence came from the wrong dates."],
    [/measures something else|states no metric scope/, "A piece of evidence didn’t measure what the claim was about."],
  ];
  for (const [re, text] of rules) if (re.test(d)) return text;
  return `${fallback}.`;
}

// A recorded event's reason in plain words, for history and change lists.
export function plainEventReason(e: { type: EventType; reason: string }, heldLabel: string): string {
  if (e.type === "held") return plainHeld(e.reason, heldLabel);
  if (/^First assessment published after both reviews/.test(e.reason)) return "Published after both AI reviews and the final check passed.";
  return e.reason;
}

// A model id as people say it: "claude-opus-5-5" is "Claude Opus 5.5",
// "gpt-6-astra" is "GPT-6 Astra".
export function modelName(id: string): string {
  const m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)$/);
  if (m) return `Claude ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  const g = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/);
  if (g) return `GPT-${g[1]}${g[2] ? ` ${g[2].charAt(0).toUpperCase()}${g[2].slice(1)}` : ""}`;
  return id;
}
