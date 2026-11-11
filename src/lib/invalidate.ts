// The invalidation-only release. When a published assessment has a verified
// problem, this flags it as under review or withdraws it without waiting for a
// replacement assessment, and it can do nothing else: no new verdict, no text
// change, no lifting of an earlier invalidation. Everything not affected is
// copied unchanged from the current release, and the result is checked
// against that release before it can be promoted.
import { NOTICE_TEXT } from "./release.ts";
import type { PublicClaim, PublicEvent, ReleaseManifest } from "./manifest.ts";
import type { Invalidation, ReviewOutput } from "../schema.ts";
import type { Store } from "./data.ts";
import { computeCounts } from "./published.ts";
import { canonicalize } from "./canonical.ts";

// Is every receipt real, and does it show what the reason code says? A raw
// dispute or an unverified allegation cannot pass this.
export function verifyInvalidation(s: Store, inv: Invalidation, opts: { quoteStillMatches?: (occurrenceId: string) => boolean | null } = {}): string[] {
  const out: string[] = [];
  const a = s.assessments.get(inv.assessment_id);
  if (!a) return [`assessment ${inv.assessment_id} does not exist`];
  const receipts = inv.trigger.receipts;
  if (inv.reason_code === "quote_mismatch" || inv.reason_code === "extraction_error") {
    const checks = receipts.filter((r) => r.kind === "quote_check");
    if (!checks.length) out.push("a quotation problem needs a quote_check receipt naming the statement");
    for (const r of checks) {
      if (!s.occurrences.has(r.ref)) { out.push(`statement ${r.ref} does not exist`); continue; }
      const m = opts.quoteStillMatches?.(r.ref);
      if (m === null || m === undefined) out.push(`the quotation for ${r.ref} could not be re-checked here`);
      else if (m) out.push(`the quotation for ${r.ref} still matches its source; there is no mismatch to act on`);
    }
  }
  if (inv.reason_code === "verified_material_counterevidence") {
    const runs = receipts.filter((r) => r.kind === "review_run").map((r) => s.reviews.get(r.ref));
    const ok = runs.filter((r) => r && r.status === "ok" && r.kind === "assessment_review" && r.output && "outcome" in r.output) as NonNullable<(typeof runs)[number]>[];
    const providers = new Set(ok.map((r) => r.provider));
    if (providers.size < 2) out.push("material counterevidence must be confirmed by completed reviews from both providers");
    const outcomes = new Set(ok.map((r) => (r.output as ReviewOutput).outcome));
    if (outcomes.size !== 1) out.push("the confirming reviews do not agree with each other");
    else if (outcomes.has(a.outcome)) out.push("the confirming reviews agree with the published outcome; there is no conflict");
  }
  if (inv.reason_code === "attribution_failure") {
    const runs = receipts.filter((r) => r.kind === "review_run").map((r) => s.reviews.get(r.ref)).filter((r) => r?.status === "ok" && r.output && "attribution" in r.output);
    const providers = new Set(runs.map((r) => r!.provider));
    if (providers.size < 2 || runs.some((r) => (r!.output as ReviewOutput).attribution.speaker_is_subject && (r!.output as ReviewOutput).attribution.endorsed)) out.push("an attribution failure must be confirmed by both providers");
  }
  if (inv.reason_code === "source_integrity_failure") {
    const ev = receipts.filter((r) => r.kind === "source_version" || r.kind === "fetch_event");
    if (!ev.length) out.push("a source-integrity failure needs a source version or fetch event receipt");
    for (const r of ev) if (r.kind === "source_version" ? !s.versions.has(r.ref) : !s.fetches.has(r.ref)) out.push(`receipt ${r.ref} does not exist`);
  }
  return out;
}

export function applyInvalidation(current: ReleaseManifest, inv: Invalidation, generatedAt: string): Omit<ReleaseManifest, "release_id" | "digest"> {
  if (current.invalidations_applied.includes(inv.invalidation_id)) throw new Error(`${inv.invalidation_id} is already applied`);
  const claims: PublicClaim[] = JSON.parse(JSON.stringify(current.claims));
  const target = claims.find((c) => c.current?.assessment_id === inv.assessment_id);
  if (!target || !target.current) throw new Error(`${inv.assessment_id} is not a current assessment in ${current.release_id}`);
  if (target.current.status === "under_review" && inv.action === "flag_under_review") throw new Error(`${inv.assessment_id} is already under review`);
  const event: PublicEvent = {
    event_id: `${target.claim_id}-${inv.action === "withdraw" ? "assessment-withdrawn" : "under-review-flagged"}-${inv.invalidation_id}`.slice(0, 120),
    type: inv.action === "withdraw" ? "assessment_withdrawn" : "under_review_flagged", claim_id: target.claim_id, subject_id: target.subject_id,
    assessment_id: inv.assessment_id, recorded_at: generatedAt, effective_at: inv.recorded_at,
    reason: inv.action === "withdraw" ? NOTICE_TEXT.withdrawn_integrity : NOTICE_TEXT.under_review_neutral, substantive: true,
  };
  if (inv.action === "withdraw") {
    target.history.push({ ...target.current, status: "withdrawn", notice: { kind: "withdrawn_integrity", reason_code: inv.reason_code, text: NOTICE_TEXT.withdrawn_integrity, since: inv.recorded_at } });
    target.current = null;
  } else {
    target.current = { ...target.current, status: "under_review", notice: { kind: "under_review_neutral", reason_code: inv.reason_code, text: NOTICE_TEXT.under_review_neutral, since: inv.recorded_at } };
  }
  target.event_ids = [event.event_id, ...target.event_ids];
  target.last_substantive_change_at = generatedAt;
  const { release_id: _r, digest: _d, ...rest } = current;
  return {
    ...rest, generated_at: generatedAt, predecessor_release_id: current.release_id, claims, events: [event, ...current.events],
    counts: computeCounts(claims, current.held.length), invalidations_applied: [...current.invalidations_applied, inv.invalidation_id],
  };
}

// The guarantee, checked rather than assumed: only the target changed, and
// only by losing endorsement.
export function onlyInvalidated(before: ReleaseManifest, after: Omit<ReleaseManifest, "release_id" | "digest">, inv: Invalidation): string[] {
  const out: string[] = [];
  const b = new Map(before.claims.map((c) => [c.claim_id, c]));
  if (after.claims.length !== before.claims.length) out.push("the set of claims changed");
  for (const c of after.claims) {
    const prev = b.get(c.claim_id);
    if (!prev) { out.push(`${c.claim_id} is new`); continue; }
    const touched = prev.current?.assessment_id === inv.assessment_id;
    if (!touched && canonicalize(prev) !== canonicalize(c)) out.push(`${c.claim_id} changed but was not the target`);
    if (touched) {
      const strip = (x: unknown) => { const { status: _s, notice: _n, ...rest } = x as Record<string, unknown>; return canonicalize(rest); };
      const kept = c.current ?? c.history.find((h) => h.assessment_id === inv.assessment_id && h.status === "withdrawn");
      if (!kept) out.push("the withdrawn assessment is not kept in history");
      else if (strip(kept) !== strip(prev.current)) out.push("the target's assessment changed beyond its status and notice");
      if (c.current && c.current.status !== "under_review") out.push("the target was not flagged");
      const earlier = c.current ? c.history : c.history.filter((h) => h !== kept);
      if (canonicalize(earlier) !== canonicalize(prev.history)) out.push("the target's earlier history changed");
      const { current: _a, history: _b, event_ids: _c, last_substantive_change_at: _d, ...restNow } = c;
      const { current: _e, history: _f, event_ids: _g, last_substantive_change_at: _h, ...restPrev } = prev;
      if (canonicalize(restNow) !== canonicalize(restPrev)) out.push("the target claim's own fields changed");
    }
  }
  for (const k of ["held", "coverage", "subjects", "reference_date", "policy_version", "code_commit"] as const) if (canonicalize(before[k]) !== canonicalize(after[k])) out.push(`${k} changed`);
  for (const id of before.invalidations_applied) if (!after.invalidations_applied.includes(id)) out.push(`invalidation ${id} was lifted`);
  return out;
}

// A rollback may not bring back an assessment that was flagged or withdrawn
// after the target release was built.
export function rollbackProblems(target: ReleaseManifest, invalidations: Invalidation[]): string[] {
  const out: string[] = [];
  for (const inv of invalidations) {
    if (target.invalidations_applied.includes(inv.invalidation_id)) continue;
    const c = target.claims.find((x) => x.current?.assessment_id === inv.assessment_id);
    if (c) out.push(`${c.claim_id}: ${inv.assessment_id} was ${inv.action === "withdraw" ? "withdrawn" : "flagged under review"} after ${target.release_id}; rolling back would restore it`);
  }
  return out;
}
