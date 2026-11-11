// The loader's cross-file checks, against small trees written to a temporary
// directory. Fixture ids are allowed only where a test says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { loadStore } from "../src/lib/data.ts";
import { sealClaim } from "../src/lib/records.ts";

const T = "2026-10-28T12:00:00Z";
const H = "d".repeat(64);

function tree(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-data-"));
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, rel.endsWith(".json") ? JSON.stringify(body, null, 2) : YAML.stringify(body));
  }
  return root;
}

function statementTree(endorsement: string, speaker: string, prefix = "fx-") {
  const claim = sealClaim({
    claim_id: `${prefix}claim`, revision: 1, subject_id: "ed-zitron", occurrence_ids: [`${prefix}occ`], normalized_proposition: "p", kind: "observation",
    target: "t", target_version: null, quantifier: null, modality: "is", conditions: [], original_horizon_text: null, original_threshold: null,
    metric_scope: null, topic_tags: ["financing"], concerns_providers: [], relation_to_prior_claim: null, revision_reason: null, created_at: T,
  });
  return {
    [`sources/${prefix}doc/document.yaml`]: { document_id: `${prefix}doc`, canonical_url: "https://example.org/p", title: "t", publisher: "p", original_author: "ed-zitron", source_type: "newsletter", original_published_at: "2025-01-02", original_date_precision: "day", original_date_provenance: "article:published_time meta", original_date_uncertain: false, discovered_at: T },
    [`sources/${prefix}doc/versions/${H}.json`]: { snapshot_hash: H, document_id: `${prefix}doc`, first_observed_at: T, observed_via: "live", archive_url: null, archive_captured_at: null, access_state: "full_public", context_completeness: "complete", parser_version: "1", normalization_version: "1", chars: 4000, public_excerpt_policy: { max_words: 40 }, private_retained: true },
    [`occurrences/${prefix}occ.yaml`]: { id: `${prefix}occ`, subject_id: "ed-zitron", document_id: `${prefix}doc`, attributed_speaker: speaker, endorsement_status: endorsement, statement_date: "2025-01-02", statement_date_precision: "day", extraction_run: "fx-run", claim_ids: [`${prefix}claim`], source_version_receipts: [{ source_snapshot_id: H, source_span: { start: 10, end: 60 }, public_excerpt: "short words", excerpt_locator: "paragraph 2", quote_hash: H, quote_verification: { status: "exact", normalization_version: "1", verified_at: T, excerpt_in_quote: true } }], continuity: { status: "single", note: null } },
    [`claims/${prefix}claim/revisions/1.yaml`]: claim,
  };
}

test("attribution", () => {
  const ok = loadStore(tree(statementTree("endorsed", "ed-zitron")), { allowFixtures: true });
  assert.deepEqual(ok.problems, []);
  const quoted = loadStore(tree(statementTree("quoted_other", "a rival analyst")), { allowFixtures: true });
  assert.ok(quoted.problems.some((p) => /rests on statements the subject endorsed/.test(p.message)), JSON.stringify(quoted.problems));
  const mislabelled = loadStore(tree(statementTree("endorsed", "a reader")), { allowFixtures: true });
  assert.ok(mislabelled.problems.some((p) => /endorsed statement is attributed to its subject/.test(p.message)));
});

test("fixture ids never load into the data tree", () => {
  const s = loadStore(tree(statementTree("endorsed", "ed-zitron")));
  assert.ok(s.problems.some((p) => /fixture id/.test(p.message)));
});

test("a third subject does not validate", () => {
  const s = loadStore(tree({ "subjects/sam-altman.yaml": { id: "sam-altman", name: "x", identification: "x", identification_source: { title: "x", url: "https://example.org" }, statement_origins: ["https://example.org"], collection_windows: ["x"], active: true, profile_links: [] } }), { allowFixtures: true });
  assert.ok(s.problems.some((p) => /subjects\/sam-altman/.test(p.file)));
  assert.ok(s.problems.some((p) => /missing subject gary-marcus/.test(p.message)));
});

test("an edited claim no longer matches its hash", () => {
  const files = statementTree("endorsed", "ed-zitron") as Record<string, any>;
  files["claims/fx-claim/revisions/1.yaml"] = { ...files["claims/fx-claim/revisions/1.yaml"], normalized_proposition: "edited after sealing" };
  const s = loadStore(tree(files), { allowFixtures: true });
  assert.ok(s.problems.some((p) => /content_hash does not match/.test(p.message)));
});
