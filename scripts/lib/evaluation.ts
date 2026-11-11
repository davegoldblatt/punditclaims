// The evaluation date for a claim: the day its evidence is gathered up to.
//
// A claim keeps the date it was first checked against. Once a packet exists
// for it, every later draft, retry, or second chance uses that packet's date,
// so moving the register's cutoff forward never re-opens an existing case.
// Re-checking a claim against a later date is a deliberate reassessment, not
// a side effect of collecting new posts.
//
// A claim with no packet yet takes the date of the window its post belongs to:
// the window's `evaluate_as_of` when set (the windows checked before the
// cutoff moved), otherwise the register's `retrieval_cutoff`.
import fs from "node:fs";
import { CONFIG } from "../../src/config.ts";
import type { Store } from "../../src/lib/data.ts";

type WindowInfo = { id: string; from: string; to: string; evaluate_as_of: string };
const WINDOWS: WindowInfo[] = CONFIG.subjects.flatMap((s) => s.windows.map((w) => ({ id: w.id, from: w.from, to: w.to, evaluate_as_of: w.evaluate_as_of ?? CONFIG.retrieval_cutoff })));

let docWindow: Map<string, string> | null = null;
// Which window each captured post was discovered in, from the coverage manifests.
export function windowOfDocument(docId: string, root = "."): string | null {
  if (!docWindow) {
    docWindow = new Map();
    for (const w of WINDOWS) {
      const f = `${root}/research/coverage/${w.id}.json`;
      if (!fs.existsSync(f)) continue;
      for (const it of JSON.parse(fs.readFileSync(f, "utf8")).items ?? []) if (!docWindow.has(it.document_id)) docWindow.set(it.document_id, w.id);
    }
  }
  return docWindow.get(docId) ?? null;
}

// The date for a post that has no checked claim yet. A post outside every
// coverage manifest falls back to the window whose dates contain the post's
// date, then to the register's cutoff.
export function windowEvaluationDate(docId: string, statementDate: string | null): string {
  const id = windowOfDocument(docId);
  const byId = id ? WINDOWS.find((w) => w.id === id) : undefined;
  if (byId) return byId.evaluate_as_of;
  const d = statementDate?.slice(0, 10);
  const byDate = d ? WINDOWS.find((w) => d >= w.from && d <= w.to) : undefined;
  return byDate?.evaluate_as_of ?? CONFIG.retrieval_cutoff;
}

// The date for one claim. Its first packet decides when there is one.
export function evaluationDateFor(s: Store, claimId: string, docId: string, statementDate: string | null): string {
  const first = [...s.packets.values()]
    .filter((p) => p.claim_revision_ref.id === claimId)
    .sort((a, b) => packetNumber(a.packet_id) - packetNumber(b.packet_id))[0];
  if (first) return String(first.evaluation_as_of);
  return windowEvaluationDate(docId, statementDate);
}

function packetNumber(id: string): number {
  const m = id.match(/-p(\d+)$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}
