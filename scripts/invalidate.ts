// node scripts/invalidate.ts <invalidation.json>
// Applies one verified invalidation as its own release: the assessment is
// flagged under review or withdrawn, nothing else changes, and the pointer
// moves only if the result checks out against the current release.
import fs from "node:fs";
import { loadStore } from "../src/lib/data.ts";
import { Invalidation } from "../src/schema.ts";
import { ReleaseManifest } from "../src/lib/manifest.ts";
import { applyInvalidation, onlyInvalidated, verifyInvalidation } from "../src/lib/invalidate.ts";
import { sealManifest } from "../src/lib/release.ts";
import { verifyManifest } from "../src/lib/published.ts";
import { getSnapshot, getPrivateJson } from "./lib/private-store.ts";
import { locateQuote } from "./lib/quote.ts";
import { privateKey } from "./lib/draft.ts";
import { movePointer, readCurrent } from "./lib/pointer.ts";
import { writePublic } from "./lib/writer.ts";
import { nowStamp } from "./lib/capture.ts";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/invalidate.ts <invalidation.json>"); process.exit(2); }
const inv = Invalidation.parse(JSON.parse(fs.readFileSync(file, "utf8")));
const s = loadStore("data");
// Re-run the quotation check against the private source text, here, now.
const quoteStillMatches = (oid: string): boolean | null => {
  const o = s.occurrences.get(oid);
  if (!o) return null;
  const r = o.source_version_receipts.at(-1)!;
  const q = getPrivateJson<{ quote: string }>("quotes", privateKey(oid, r.quote_hash));
  const text = getSnapshot(r.source_snapshot_id);
  if (!q || !text) return null;
  return locateQuote(text, q.quote).status !== "failed";
};
const problems = verifyInvalidation(s, inv, { quoteStillMatches });
if (problems.length) { for (const p of problems) console.error(`REFUSED ${p}`); process.exit(1); }
const cur = readCurrent();
if (!cur) { console.error("there is no current release to invalidate"); process.exit(1); }
const before = verifyManifest(ReleaseManifest.parse(JSON.parse(fs.readFileSync(`data/releases/${cur.release_id}/manifest.json`, "utf8"))), { fixture: false });
const after = applyInvalidation(before, inv, nowStamp());
const diff = onlyInvalidated(before, after, inv);
if (diff.length) { for (const p of diff) console.error(`REFUSED ${p}`); process.exit(1); }
const sealed = sealManifest(after);
verifyManifest(sealed, { fixture: false });
writePublic(`data/invalidations/${inv.invalidation_id}.json`, Invalidation, inv);
writePublic(`data/releases/${sealed.release_id}/manifest.json`, ReleaseManifest, sealed);
movePointer({ release_id: sealed.release_id, manifest_digest: sealed.digest, updated_at: sealed.generated_at, predecessor_release_id: cur.release_id }, cur.release_id);
console.log(`${inv.action === "withdraw" ? "withdrew" : "flagged"} ${inv.assessment_id}; current release is now ${sealed.release_id}. Rebuild and promote the site to make it public.`);
