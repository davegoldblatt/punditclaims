// node scripts/release.ts [--reference-date YYYY-MM-DD] [--dry-run]
// Builds a release manifest from the data tree, writes any new events, and
// moves data/current-release.json to it atomically, only if the pointer still
// names the predecessor this build started from. A build with any problem
// writes nothing and leaves the current release as it was.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { loadStore } from "../src/lib/data.ts";
import { buildRelease, sealManifest } from "../src/lib/release.ts";
import { verifyManifest } from "../src/lib/published.ts";
import { Event, CurrentRelease } from "../src/schema.ts";
import { ReleaseManifest } from "../src/lib/manifest.ts";
import { writePublic } from "./lib/writer.ts";
import { CONFIG, SOURCE_WINDOWS } from "../src/config.ts";
import { nowStamp } from "./lib/capture.ts";
import { movePointer, readCurrent } from "./lib/pointer.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--reference-date");
const generatedAt = nowStamp();
const referenceDate = at >= 0 ? args[at + 1] : generatedAt.slice(0, 10);
const dry = args.includes("--dry-run");
const commit = execSync("git rev-parse HEAD").toString().trim();
const dirty = execSync("git status --porcelain -- src scripts policy").toString().trim();
if (dirty && !dry) { console.error(`refusing: the code that builds a release must be committed first:\n${dirty}`); process.exit(1); }

const current = readCurrent();
const predecessor = current ? ReleaseManifest.parse(JSON.parse(fs.readFileSync(`data/releases/${current.release_id}/manifest.json`, "utf8"))) : null;
const built = buildRelease({ store: loadStore("data"), referenceDate, generatedAt, codeCommit: commit, predecessor, config: { source_windows: SOURCE_WINDOWS, retrieval_cutoff: CONFIG.retrieval_cutoff } });
for (const [id, g] of built.gateResults) console.log(`${g.result === "published" ? "PUBLISH" : "HOLD   "} ${id}${g.reason ? ` (${g.reason})` : ""}`);
// No process.exit after the per-claim lines: exit drops output still queued
// for a pipe, so a reader of a dry run could lose the summary line. The
// script ends on its own instead.
if (built.problems.length) { for (const p of built.problems) console.error(`PROBLEM ${p}`); console.error("no release written"); process.exitCode = 1; }
else {
  const manifest = sealManifest(built.body);
  verifyManifest(manifest, { fixture: false });
  const c = manifest.counts;
  console.log(`${manifest.release_id}: ${c.distinct_claims} published (${Object.entries(c.by_subject).map(([k, v]) => `${k} ${v}`).join(", ")}), ${c.held} held, ${c.withdrawn} withdrawn; open regressions: ${manifest.regressions_open.length}`);
  if (!dry) {
    for (const e of built.newEvents) writePublic(`data/events/${e.event_id}.json`, Event, { ...e, release_id: manifest.release_id });
    writePublic(`data/releases/${manifest.release_id}/manifest.json`, ReleaseManifest, manifest);
    movePointer({ release_id: manifest.release_id, manifest_digest: manifest.digest, updated_at: generatedAt, predecessor_release_id: current?.release_id ?? null }, current?.release_id ?? null);
    console.log(`current release is now ${manifest.release_id}`);
  }
}
