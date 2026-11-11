// The page-facing views over a release: labels never present a withdrawn
// verdict as current, citations name the assessment version and cutoff,
// dispute links fill the issue form's own field ids, and ordering is stable.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";
import { verifyManifest } from "../src/lib/published.ts";
import {
  assessmentLabel, bySaid, citation, disputeUrl, qualification, shownAssessment, standingOf, statementOccurrence, topicLabel, versionsOf,
} from "../src/lib/view.ts";

const m = verifyManifest(JSON.parse(fs.readFileSync("fixtures/release/manifest.json", "utf8")), { fixture: true });
const claim = (id: string) => m.claims.find((c) => c.claim_id === id)!;

test("a withdrawn assessment is never labelled with its old outcome", () => {
  const c = claim("fx-withdrawn");
  assert.equal(standingOf(c), "withdrawn");
  assert.equal(assessmentLabel(c), "Assessment withdrawn");
  assert.equal(shownAssessment(c)?.status, "withdrawn");
  assert.match(citation(m, c, shownAssessment(c), "https://example.test", "Ed Zitron"), /withdrawn on 2026-10-26/);
  assert.doesNotMatch(citation(m, c, shownAssessment(c), "https://example.test", "Ed Zitron"), /Contradicted/);
});

test("a citation names the claim, the assessment version, the evidence cutoff, and the release", () => {
  const c = claim("fx-long-forecast");
  const s = citation(m, c, c.current, "https://example.test", "Gary Marcus");
  // The assessment a claim page shows is cited at its anchor on that page;
  // every other version is cited at its own page.
  for (const part of ["fx-long-forecast", c.current!.assessment_id, `evidence as of ${c.current!.payload.evaluation_as_of}`, m.release_id, `https://example.test/claims/fx-long-forecast#assessment-${c.current!.assessment_id}`]) assert.ok(s.includes(part), part);
  const old = claim("fx-corrected");
  assert.ok(citation(m, old, old.history[0], "https://example.test", "Gary Marcus").endsWith(`https://example.test/claims/fx-corrected/v/${old.history[0].assessment_id}`));
});

test("a screened-out claim is cited and labelled without an evidence date", () => {
  const c = claim("fx-screened-rhetoric");
  assert.equal(c.current!.final_text, null);
  assert.equal(assessmentLabel(c), "Can’t be checked");
  const s = citation(m, c, c.current, "https://example.test", "Ed Zitron");
  assert.match(s, /Can’t be checked, not checked against evidence/);
  assert.doesNotMatch(s, /evidence as of/);
});

test("versions are listed oldest first, once each, with the current one last", () => {
  const v = versionsOf(claim("fx-corrected")).map((a) => `${a.assessment_id}:${a.status}`);
  assert.deepEqual(v, ["fx-corrected-a1:superseded", "fx-corrected-a2:current"]);
});

test("the dispute link fills the issue form's own field ids", () => {
  const form = YAML.parse(fs.readFileSync(".github/ISSUE_TEMPLATE/dispute.yml", "utf8"));
  const ids = form.body.filter((b: { id?: string }) => b.id).map((b: { id: string }) => b.id);
  for (const required of ["claim_id", "assessment_id", "contested", "correction", "source"]) assert.ok(ids.includes(required), required);
  const u = new URL(disputeUrl("https://github.com/owner/repo", "fx-mixed", "fx-mixed-a1"));
  assert.equal(u.pathname, "/owner/repo/issues/new");
  assert.equal(u.searchParams.get("template"), "dispute.yml");
  assert.equal(u.searchParams.get("claim_id"), "fx-mixed");
  assert.equal(u.searchParams.get("assessment_id"), "fx-mixed-a1");
  for (const k of u.searchParams.keys()) assert.ok(k === "template" || k === "title" || ids.includes(k), `unknown prefill key ${k}`);
});

test("a row's qualification keeps a conditional's antecedent first", () => {
  assert.deepEqual(qualification(claim("fx-conditional")), { label: "Only if", text: "[Synthetic] Example Lab's next funding round falls short" });
  assert.equal(qualification(claim("fx-long-forecast")), null);
});

test("the register orders by the date first said, newest first, with ties by id", () => {
  const order = [...m.claims].sort(bySaid).map((c) => c.first_statement_date);
  assert.deepEqual(order, [...order].sort().reverse());
});

test("the statement occurrence is matched by excerpt and date", () => {
  const c = claim("fx-review-due");
  assert.equal(statementOccurrence(c, c.current!.payload)?.id, "fx-review-due-occ-1");
});

test("topic slugs read as words", () => {
  assert.equal(topicLabel("agi-timelines"), "AGI timelines");
  assert.equal(topicLabel("business-economics"), "Business economics");
});
