// node scripts/rollback.ts --to <release-id>
// Points the site back at an earlier release, unless that would restore an
// assessment flagged or withdrawn since. In that case it refuses: fix forward
// with a new release instead.
import fs from "node:fs";
import { loadStore } from "../src/lib/data.ts";
import { ReleaseManifest } from "../src/lib/manifest.ts";
import { verifyManifest } from "../src/lib/published.ts";
import { rollbackProblems } from "../src/lib/invalidate.ts";
import { movePointer, readCurrent } from "./lib/pointer.ts";
import { nowStamp } from "./lib/capture.ts";

const at = process.argv.indexOf("--to");
const to = at > 0 ? process.argv[at + 1] : null;
if (!to) { console.error("usage: node scripts/rollback.ts --to <release-id>"); process.exit(2); }
const target = verifyManifest(ReleaseManifest.parse(JSON.parse(fs.readFileSync(`data/releases/${to}/manifest.json`, "utf8"))), { fixture: false });
const problems = rollbackProblems(target, [...loadStore("data").invalidations.values()]);
if (problems.length) { for (const p of problems) console.error(`REFUSED ${p}`); console.error("Roll forward instead: build a new release from the current data."); process.exit(1); }
const cur = readCurrent();
movePointer({ release_id: target.release_id, manifest_digest: target.digest, updated_at: nowStamp(), predecessor_release_id: cur?.release_id ?? null }, cur?.release_id ?? null);
console.log(`current release is now ${target.release_id}. Rebuild and promote the site to make it public.`);
