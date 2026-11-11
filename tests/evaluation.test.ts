// The evaluation date a claim is checked against (scripts/lib/evaluation.ts).
// Moving the register's cutoff must never re-open an existing case.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluationDateFor, windowEvaluationDate } from "../scripts/lib/evaluation.ts";
import { CONFIG } from "../src/config.ts";
import type { Store } from "../src/lib/data.ts";

const store = (packets: { id: string; claim: string; asOf: string }[]) =>
  ({ packets: new Map(packets.map((p) => [p.id, { packet_id: p.id, claim_revision_ref: { id: p.claim }, evaluation_as_of: p.asOf }])) }) as unknown as Store;

const firstDoc = (windowId: string) => {
  const f = `research/coverage/${windowId}.json`;
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")).items.find((i: { status: string }) => i.status === "captured")?.document_id as string | undefined) : undefined;
};

test("a claim keeps its first packet's date, whatever came later", () => {
  const s = store([{ id: "x-p2", claim: "x", asOf: "2026-11-09" }, { id: "x-p1", claim: "x", asOf: "2026-10-28" }, { id: "y-p1", claim: "y", asOf: "2026-01-01" }]);
  assert.equal(evaluationDateFor(s, "x", "any-doc", null), "2026-10-28");
  // Another claim's packet never decides it (control: y's date is different).
  assert.notEqual(evaluationDateFor(s, "x", "any-doc", null), "2026-01-01");
});

test("a claim with no packet takes its window's date", () => {
  const windows = CONFIG.subjects.flatMap((s) => s.windows);
  const pinned = windows.find((w) => w.evaluate_as_of);
  const rolling = windows.find((w) => !w.evaluate_as_of);
  if (pinned) {
    const doc = firstDoc(pinned.id);
    if (doc) assert.equal(evaluationDateFor(store([]), "new", doc, null), pinned.evaluate_as_of);
  }
  if (rolling) {
    const doc = firstDoc(rolling.id);
    if (doc) assert.equal(evaluationDateFor(store([]), "new", doc, null), CONFIG.retrieval_cutoff);
  }
  // Control: the two kinds of window really do differ in this register.
  if (pinned && rolling) assert.notEqual(pinned.evaluate_as_of, CONFIG.retrieval_cutoff);
});

test("a post outside every manifest falls back by its date, then the cutoff", () => {
  const w = CONFIG.subjects.flatMap((s) => s.windows).find((x) => x.evaluate_as_of)!;
  assert.equal(windowEvaluationDate("not-a-real-document", `${w.from}T12:00:00Z`), w.evaluate_as_of);
  assert.equal(windowEvaluationDate("not-a-real-document", "1999-01-01"), CONFIG.retrieval_cutoff);
});
