// The one public dataset: the fixture release verifies, and any tampering,
// fixture leak, or count drift is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyManifest } from "../src/lib/published.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "../src/lib/canonical.ts";

const fixture = () => JSON.parse(fs.readFileSync("fixtures/release/manifest.json", "utf8"));
const reseal = (m: any) => ({ ...m, digest: hashOf(m, OWN_DIGEST_FIELDS.manifest) });

test("snapshot-consistency", () => {
  assert.doesNotThrow(() => verifyManifest(fixture(), { fixture: true }));
  // A fixture can never be the production release.
  assert.throws(() => verifyManifest(fixture(), { fixture: false }), /fixture/);
  assert.throws(() => verifyManifest(reseal({ ...fixture(), fixture: false }), { fixture: false }), /fixture claim/);
  // Any edit without resealing breaks the digest.
  const m = fixture();
  m.claims[0].normalized_proposition += " edited";
  assert.throws(() => verifyManifest(m, { fixture: true }), /digest/);
  // An edited payload, resealed, still fails its own hash.
  const p = fixture();
  p.claims[0].current.payload.rationale += " edited";
  assert.throws(() => verifyManifest(reseal(p), { fixture: true }), /payload/);
  // Counts must be recomputable from the claims.
  const c = fixture();
  c.counts.distinct_claims += 1;
  assert.throws(() => verifyManifest(reseal(c), { fixture: true }), /counts/);
  // One provider cannot review twice.
  const r = fixture();
  r.claims[0].current.reviewers[1].provider = "anthropic";
  assert.throws(() => verifyManifest(reseal(r), { fixture: true }), /one provider/);
});
