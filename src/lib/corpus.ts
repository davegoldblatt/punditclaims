// The full-corpus machinery that keeps the run honest at scale:
// - a ledger with one line per post, per extraction candidate, and per legacy
//   row, each ending in a disposition, so "every claim" can be checked;
// - the routing table that decides which claims need evidence;
// - the merge guard that refuses to merge two statements whose commitments
//   differ in anything material.
import { HEDGED_MODALITIES, type ClaimKind } from "../policy.ts";

// --- ledger -------------------------------------------------------------------

export type PostLine = { kind: "post"; id: string; window: string; url: string; access_state: string; status: "pending" | "extracted" | "zero_claims" | "inaccessible" | "failed"; candidates: number; note: string | null };
export type CandidateLine = { kind: "candidate"; id: string; post: string; quote_hash: string; status: "pending" | "claim" | "merged" | "rejected"; claim_id: string | null; merged_into: string | null; reason: string | null };
export type LegacyLine = { kind: "legacy"; id: string; post: string; status: "pending" | "matched" | "added" | "rejected" | "no_post"; claim_id: string | null; reason: string | null };
export type LedgerLine = PostLine | CandidateLine | LegacyLine;

// Every line must end in a final disposition, and every disposition must be
// complete: a claim names its claim id, a merge names its target, a rejection
// and a failure name a reason.
export function ledgerProblems(lines: LedgerLine[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const posts = new Map<string, PostLine>();
  for (const l of lines) {
    const key = `${l.kind}:${l.id}`;
    if (seen.has(key)) out.push(`${key} appears twice`);
    seen.add(key);
    if (l.kind === "post") posts.set(l.id, l);
    if (l.status === "pending") out.push(`${key} has no disposition`);
  }
  for (const l of lines) {
    const key = `${l.kind}:${l.id}`;
    if (l.kind === "post") {
      if ((l.status === "inaccessible" || l.status === "failed") && !l.note) out.push(`${key} is ${l.status} without a note`);
      const n = lines.filter((c) => c.kind === "candidate" && c.post === l.id).length;
      if (l.status === "extracted" && n !== l.candidates) out.push(`${key} says ${l.candidates} candidates, the ledger has ${n}`);
      if (l.status === "extracted" && n === 0) out.push(`${key} is extracted with no candidates; mark it zero_claims`);
      if (l.status === "zero_claims" && n > 0) out.push(`${key} is zero_claims but has candidates`);
    }
    if (l.kind === "candidate") {
      const p = posts.get(l.post);
      if (!p) out.push(`${key} names a post the ledger does not have`);
      else if (p.status !== "extracted") out.push(`${key} belongs to a post marked ${p.status}`);
      if (l.status === "claim" && !l.claim_id) out.push(`${key} is a claim without a claim id`);
      if (l.status === "merged" && !l.merged_into) out.push(`${key} is merged without a target`);
      if (l.status === "rejected" && !l.reason) out.push(`${key} is rejected without a reason`);
    }
    if (l.kind === "legacy") {
      if ((l.status === "matched" || l.status === "added") && !l.claim_id) out.push(`${key} is ${l.status} without a claim id`);
      if ((l.status === "rejected" || l.status === "no_post") && !l.reason) out.push(`${key} is ${l.status} without a reason`);
    }
  }
  return out;
}

// --- routing --------------------------------------------------------------------

export type RouteIn = { kind: ClaimKind; modality: string; has_stated_horizon: boolean; has_target_period: boolean; graded_confidence: "high" | "medium" | "low" | null };
export type RouteOut = { track: "evidence" | "no_evidence" | "hold"; reason: string };

// Exhaustive, in order of precedence. Reviewers confirm the routing as part of
// the semantic review; this table only decides where drafting effort goes.
export function routeClaim(c: RouteIn): RouteOut {
  if (c.kind === "normative") return { track: "no_evidence", reason: "a recommendation or value judgment is recorded, not scored" };
  if (c.kind === "rhetoric") return { track: "no_evidence", reason: "rhetoric commits to no testable proposition" };
  if (c.graded_confidence === "medium" || c.graded_confidence === "low") return { track: "no_evidence", reason: `filed under ${c.graded_confidence} confidence, so not scored` };
  if (HEDGED_MODALITIES.has(c.modality)) return { track: "no_evidence", reason: `"${c.modality}" is probability or possibility language, so not scored` };
  if (c.kind === "forecast" || c.kind === "conditional_forecast") return { track: "evidence", reason: c.has_stated_horizon ? "a firm forecast with a stated horizon" : "a firm forecast with no stated deadline: only a conclusive event can settle it" };
  if (c.kind === "observation") return c.has_target_period ? { track: "evidence", reason: "an observation about a stated period" } : { track: "hold", reason: "an observation whose period is not stated: the drafter must fix the period from the statement before routing" };
  if (c.kind === "causal") return { track: "evidence", reason: "a causal claim needs evidence suited to causation" };
  return { track: "hold", reason: "no routing rule applies" };
}

// --- merging --------------------------------------------------------------------

// What a statement commits its speaker to, normalised for comparison.
export type Commitment = {
  subject_id: string; kind: ClaimKind; polarity: "affirm" | "deny"; modality: string; predicate: string; target: string; target_version: string | null;
  threshold: string | null; metric: string | null; conditions: string[]; observation_period: string | null; horizon_end: string | null; graded_confidence: string | null;
};

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Code refuses any merge where a material field differs. Matching fields are
// necessary, not sufficient: the semantic sameness of the predicate is a
// model's proposal that the reviewers then check.
export function mergeRefusal(a: Commitment, b: Commitment): string | null {
  const fields: (keyof Commitment)[] = ["subject_id", "kind", "polarity", "modality", "predicate", "target", "target_version", "threshold", "metric", "observation_period", "horizon_end", "graded_confidence"];
  for (const f of fields) if (norm(a[f] as string | null) !== norm(b[f] as string | null)) return `${f} differs (${a[f] ?? "none"} vs ${b[f] ?? "none"})`;
  const ca = [...a.conditions].map(norm).sort().join("|"), cb = [...b.conditions].map(norm).sort().join("|");
  if (ca !== cb) return "the conditions differ";
  return null;
}
