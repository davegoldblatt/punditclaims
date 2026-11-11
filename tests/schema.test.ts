import { test } from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { buildCase } from "../fixtures/lib/case.ts";
import { Assessment, ClaimRevision, Invalidation, PublicExcerpt, ResolutionContract, SourceDocument, SourceVersion } from "../src/schema.ts";
import { hashOf, canonicalize } from "../src/lib/canonical.ts";

const H = "a".repeat(64);
const version = {
  snapshot_hash: H, document_id: "fx-doc", first_observed_at: "2026-10-28T00:00:00Z", observed_via: "live", archive_url: null, archive_captured_at: null,
  access_state: "full_public", context_completeness: "complete", parser_version: "1", normalization_version: "1", chars: 5000,
  public_excerpt_policy: { max_words: 40 }, private_retained: true,
};

test("source-access", () => {
  assert.equal(SourceVersion.safeParse(version).success, true);
  // A paywall preview is never complete context.
  assert.equal(SourceVersion.safeParse({ ...version, access_state: "public_preview" }).success, false);
  assert.equal(SourceVersion.safeParse({ ...version, access_state: "public_preview", context_completeness: "partial" }).success, true);
  // An archived observation names where and when it was captured.
  assert.equal(SourceVersion.safeParse({ ...version, observed_via: "archive" }).success, false);
  // A sitemap date is never presented as a known publication date.
  const doc = { document_id: "fx-doc", canonical_url: "https://example.org/p", title: "t", publisher: "p", original_author: "gary-marcus", source_type: "newsletter",
    original_published_at: "2025-01-02", original_date_precision: "day", original_date_provenance: "sitemap lastmod", original_date_uncertain: false, discovered_at: "2026-10-28T00:00:00Z" };
  assert.equal(SourceDocument.safeParse(doc).success, false);
  assert.equal(SourceDocument.safeParse({ ...doc, original_date_uncertain: true }).success, true);
  assert.equal(SourceDocument.safeParse({ ...doc, canonical_url: "http://example.org/p", original_date_uncertain: true }).success, false, "https only");
});

test("dates stay strings and partial dates are accepted", () => {
  const c = buildCase();
  assert.equal(ClaimRevision.safeParse(c.claim).success, true);
  assert.equal(ResolutionContract.safeParse({ ...c.contract, horizon_interval: { start: null, end: "2025", precision: "year" } }).success, true);
  assert.equal(ResolutionContract.safeParse({ ...c.contract, horizon_interval: { start: null, end: new Date("2025-12-31"), precision: "day" } }).success, false);
});

test("impossible dates and backwards intervals are refused", async () => {
  const { PartialDate, Timestamp, Interval } = await import("../src/schema.ts");
  for (const d of ["2026-02-31", "2026-13-01", "2026-00-10", "2025-02-29"]) assert.equal(PartialDate.safeParse(d).success, false, d);
  for (const d of ["2024-02-29", "2026", "2026-10", "2026-10-28"]) assert.equal(PartialDate.safeParse(d).success, true, d);
  assert.equal(Timestamp.safeParse("2026-10-28T25:00:00Z").success, false);
  assert.equal(Timestamp.safeParse("2026-02-30T10:00:00Z").success, false);
  assert.equal(Interval.safeParse({ start: "2026-05", end: "2026-04", precision: "month" }).success, false);
  assert.equal(Interval.safeParse({ start: "2026", end: "2026-04", precision: "month" }).success, true);
});

test("no deadline is inferred and an observation names its period", () => {
  const c = buildCase();
  assert.equal(ResolutionContract.safeParse({ ...c.contract, original_horizon: null }).success, false);
  assert.equal(ResolutionContract.safeParse({ ...c.contract, assessment_axis: "historical_observation", horizon_interval: null, original_horizon: null, target_period: null }).success, false);
});

test("an ungraded axis records not_adjudicable and the payload agrees with the assessment", () => {
  const c = buildCase();
  assert.equal(Assessment.safeParse(c.assessment).success, true);
  assert.equal(Assessment.safeParse({ ...c.assessment, axis: "not_applicable", horizon_state: "not_applicable" }).success, false);
  assert.equal(Assessment.safeParse({ ...c.assessment, public_payload: { ...c.assessment.public_payload, outcome: "contradicted" } }).success, false);
  assert.equal(Assessment.safeParse({ ...c.assessment, horizon_state: "not_applicable" }).success, false);
});

test("public excerpts are bounded by the policy's limit", async () => {
  const { MAX_EXCERPT_WORDS } = await import("../src/policy.ts");
  assert.equal(PublicExcerpt.safeParse("word ".repeat(MAX_EXCERPT_WORDS).trim()).success, true);
  assert.equal(PublicExcerpt.safeParse("word ".repeat(MAX_EXCERPT_WORDS + 1).trim()).success, false);
});

test("withdrawal needs an integrity failure; counterevidence only flags", () => {
  const base = { invalidation_id: "fx-inv", assessment_id: "fx-a", trigger: { kind: "integrity_check", receipts: [{ kind: "quote_check", ref: "x", detail: "y" }] }, recorded_at: "2026-10-28T00:00:00Z" };
  assert.equal(Invalidation.safeParse({ ...base, action: "withdraw", reason_code: "quote_mismatch", notice_template: "withdrawn_integrity" }).success, true);
  assert.equal(Invalidation.safeParse({ ...base, action: "withdraw", reason_code: "verified_material_counterevidence", notice_template: "withdrawn_integrity" }).success, false);
  assert.equal(Invalidation.safeParse({ ...base, action: "flag_under_review", reason_code: "verified_material_counterevidence", notice_template: "under_review_neutral" }).success, true);
  assert.equal(Invalidation.safeParse({ ...base, action: "flag_under_review", reason_code: "quote_mismatch", notice_template: "under_review_neutral", trigger: { kind: "integrity_check", receipts: [] } }).success, false);
});

test("canonical hashing is order-independent for keys, order-dependent for arrays, and refuses floats", () => {
  assert.equal(hashOf({ a: 1, b: [1, 2] }), hashOf({ b: [1, 2], a: 1 }));
  assert.notEqual(hashOf({ a: [1, 2] }), hashOf({ a: [2, 1] }));
  assert.throws(() => canonicalize({ x: 1.5 }));
  assert.equal(hashOf({ a: 1, content_hash: "z" }, ["content_hash"]), hashOf({ a: 1 }));
  const c = buildCase();
  assert.equal(hashOf(c.claim, ["content_hash"]), c.claim.content_hash);
  assert.notEqual(hashOf({ ...c.claim, normalized_proposition: c.claim.normalized_proposition + " " }, ["content_hash"]), c.claim.content_hash, "a one-character edit changes the hash");
});

test("legacy candidates are quarantined", () => {
  if (!fs.existsSync("research/candidates/legacy-gary-marcus.jsonl")) return;
  const first = JSON.parse(fs.readFileSync("research/candidates/legacy-gary-marcus.jsonl", "utf8").split("\n")[0]);
  assert.ok(first.legacy && "status_at_eval" in first.legacy, "legacy fields sit under `legacy`");
  assert.ok(!("status_at_eval" in first) && !("outcome" in first), "no legacy verdict at the top level");
  const reviewCode = fs.readFileSync("scripts/lib/review.ts", "utf8");
  assert.ok(!/legacy/.test(reviewCode), "the reviewers never see legacy data");
});
