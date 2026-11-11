// Lists that stay usable at any size: register groups split into pages,
// one page per source post, exports split into parts, and one built file per
// claim. Checked on the fixture release and on a generated scale fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { scaleManifestPath, verifyManifest } from "../src/lib/published.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "../src/lib/canonical.ts";
import { UNCHECKABLE_REASONS } from "../src/policy.ts";
import type { PublicClaim, ReleaseManifest } from "../src/lib/manifest.ts";
import { GROUPS, inGroup, listings, listPath, PAGE_SIZE, postKey, posts } from "../src/lib/listing.ts";
import { assessmentPath, hasVersionPage, isScreenedOut, shownAssessment, uncheckableReasons, versionsOf } from "../src/lib/view.ts";
import { claimsPart, claimsPartOf, partCount, releaseHead, releasePart } from "../src/lib/exports.ts";

const m = verifyManifest(JSON.parse(fs.readFileSync("fixtures/release/manifest.json", "utf8")), { fixture: true });
const claim = (id: string) => m.claims.find((c) => c.claim_id === id)!;
const isLive = (c: PublicClaim) => !!c.current && c.current.status !== "withdrawn";
const live = m.claims.filter(isLive);

test("the groups split the live claims: checked first, the claims that can't be checked apart", () => {
  const ids = (g: (typeof GROUPS)[number]) => live.filter((c) => inGroup(c, g)).map((c) => c.claim_id);
  assert.deepEqual([...ids("checked"), ...ids("uncheckable")].sort(), live.map((c) => c.claim_id).sort());
  assert.equal(ids("checked").filter((id) => ids("uncheckable").includes(id)).length, 0);
  const parts = ["supported", "contradicted", "mixed", "unresolved", "not-yet-due"] as const;
  assert.deepEqual(parts.flatMap((g) => ids(g)).sort(), ids("checked").sort(), "the five outcome groups partition the checked claims");
  assert.ok(ids("not-yet-due").includes("fx-not-due"));
  assert.ok(ids("unresolved").includes("fx-review-due"), "a forecast whose deadline passed after assessment is unresolved, not 'not yet due'");
  for (const id of ["fx-screened-value", "fx-screened-rhetoric", "fx-screened-chance", "fx-normative"]) assert.ok(ids("uncheckable").includes(id), id);
});

// Owner decision 2026-10-29: the home page answers "were they right?" and no
// longer lists every claim, so the register for both people has its own page.
test("register pages hold at most PAGE_SIZE rows, in order, and the full register has its own page", () => {
  assert.equal(listPath(null, "checked"), "/register/checked");
  assert.equal(listPath(null, "checked", 2), "/register/checked/2");
  // Owner decision 2026-10-30: a person's page holds the Explore tool, so their
  // checked register has its own page too.
  assert.equal(listPath("gary-marcus", "checked"), "/people/gary-marcus/checked");
  assert.equal(listPath("gary-marcus", "uncheckable", 3), "/people/gary-marcus/uncheckable/3");
  const all = listings(live, null);
  assert.equal(all[0].group, "checked");
  assert.equal(all[0].page, 1);
  for (const l of all) assert.ok(l.rows.length <= PAGE_SIZE);
});

test("a screened-out claim has no final-text check, and its reasons read as sentences", () => {
  const c = claim("fx-screened-rhetoric");
  const a = c.current!;
  assert.equal(a.final_text, null);
  assert.ok(isScreenedOut(a));
  assert.deepEqual(a.payload.uncheckable, ["no_plain_reading", "rhetoric"]);
  assert.equal(a.payload.evidence.length, 0);
  assert.deepEqual(uncheckableReasons(a), ["Too vague to test: informed readers would test it in different ways and reach different answers.", "Rhetoric that commits to nothing testable."]);
  assert.equal(isScreenedOut(claim("fx-normative").current), false, "a recommendation graded in full is not a screened-out claim");
});

test("one page per source post lists every claim recorded from it, in the order of the post", () => {
  const ps = posts(m.claims, m.held);
  const p = ps.find((x) => x.key.endsWith("/fx-post-predictions"))!;
  assert.deepEqual(p.items.map((i) => i.claim.claim_id), ["fx-screened-value", "fx-mixed", "fx-normative", "fx-screened-chance"]);
  assert.deepEqual(p.held.map((h) => h.id), ["fx-held-split"]);
  assert.equal(p.path, "/posts/example.org/synthetic/posts/fx-post-predictions");
  // A claim said in three posts appears on all three.
  assert.equal(ps.filter((x) => x.items.some((i) => i.claim.claim_id === "fx-review-due")).length, 3);
  // Every claim is on the page of the post its assessment quotes; addresses are unique.
  for (const c of m.claims) assert.ok(ps.some((x) => x.key === postKey(shownAssessment(c)!.payload.statement.url) && x.items.some((i) => i.claim === c)), c.claim_id);
  assert.equal(new Set(ps.map((x) => x.path)).size, ps.length);
  // One address however it is written.
  assert.equal(postKey("https://Example.org/a/b/?x=1#y"), postKey("https://example.org/a/b"));
});

test("one file per claim: only versions the claim page does not show get a page", () => {
  const c = claim("fx-corrected");
  const [old, cur] = versionsOf(c);
  assert.equal(hasVersionPage(c, cur.assessment_id), false);
  assert.equal(assessmentPath(c, cur.assessment_id), `/claims/fx-corrected#assessment-${cur.assessment_id}`);
  assert.equal(hasVersionPage(c, old.assessment_id), true);
  assert.equal(assessmentPath(c, old.assessment_id), `/claims/fx-corrected/v/${old.assessment_id}`);
  // A withdrawn claim's tombstone page shows the withdrawn version.
  assert.equal(hasVersionPage(claim("fx-withdrawn"), shownAssessment(claim("fx-withdrawn"))!.assessment_id), false);
});

function rebuild(rm: ReleaseManifest) {
  const head = releaseHead(rm, "https://example.test");
  const { claims_in_parts, ...rest } = head;
  const claims = Array.from({ length: claims_in_parts.parts.length }, (_, i) => releasePart(rm, i + 1).claims).flat();
  return { ...rest, claims };
}

test("the release export in parts rebuilds the manifest and its digest", () => {
  assert.equal(hashOf(rebuild(m), OWN_DIGEST_FIELDS.manifest), m.digest);
  const ids = Array.from({ length: partCount(m.claims.length) }, (_, i) => claimsPart(m, i + 1, "https://example.test").claims.map((c) => c.claim.claim_id)).flat();
  assert.deepEqual([...ids].sort(), m.claims.map((c) => c.claim_id).sort());
  for (const c of m.claims) assert.ok(claimsPart(m, claimsPartOf(m.claims, c.claim_id), "https://example.test").claims.some((x) => x.claim.claim_id === c.claim_id));
});

test("the scale fixture: about 40 percent screened out, grouped into posts, every list bounded", () => {
  const n = 600;
  const run = spawnSync(process.execPath, ["--no-warnings", "fixtures/release/build.ts"], { env: { ...process.env, PC_FIXTURE_SCALE: String(n) }, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const big = verifyManifest(JSON.parse(fs.readFileSync(scaleManifestPath(n), "utf8")), { fixture: true });
  assert.equal(big.claims.length, n);
  const screened = big.claims.filter((c) => isScreenedOut(shownAssessment(c)));
  assert.ok(screened.length > n * 0.3 && screened.length < n * 0.5, `${screened.length} screened out of ${n}`);
  for (const c of screened) {
    const a = shownAssessment(c)!;
    assert.equal(a.final_text, null);
    assert.equal(a.payload.outcome, "not_adjudicable");
    assert.equal(a.payload.axis, "not_applicable");
    assert.equal(a.payload.evidence.length, 0);
    assert.ok(a.payload.uncheckable!.every((r) => (UNCHECKABLE_REASONS as readonly string[]).includes(r)));
  }
  const ps = posts(big.claims, big.held);
  assert.ok(ps.length > n / 30 && ps.length < n / 4, `${ps.length} posts`);
  const bigLive = big.claims.filter(isLive);
  for (const scope of [null, ...big.subjects.map((s) => s.id)]) {
    const ls = listings(bigLive, scope);
    assert.ok(ls.every((l) => l.rows.length <= PAGE_SIZE));
    const listed = ls.filter((l) => l.group === "checked" || l.group === "uncheckable").flatMap((l) => l.rows.map((c) => c.claim_id));
    assert.equal(new Set(listed).size, (scope ? bigLive.filter((c) => c.subject_id === scope) : bigLive).length, "every live claim is on exactly one page of checked or can't-be-checked");
  }
  assert.equal(hashOf(rebuild(big), OWN_DIGEST_FIELDS.manifest), big.digest);
});
