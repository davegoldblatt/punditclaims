// The current-release pointer. It moves only by an atomic rename, under a
// lock, and only if it still names the release the caller started from, so
// two concurrent runs cannot both win and a failed run never moves it.
import fs from "node:fs";
import path from "node:path";
import { CurrentRelease } from "../../src/schema.ts";

const ROOT = path.resolve(process.env.PC_ROOT ?? process.cwd());
const FILE = path.join(ROOT, "data/current-release.json");
const LOCK = path.join(ROOT, "data/.release-lock");

export function readCurrent(): CurrentRelease | null {
  return fs.existsSync(FILE) ? CurrentRelease.parse(JSON.parse(fs.readFileSync(FILE, "utf8"))) : null;
}

export function movePointer(next: CurrentRelease, expected: string | null): void {
  CurrentRelease.parse(next);
  if (!fs.existsSync(path.join(ROOT, "data/releases", next.release_id, "manifest.json"))) throw new Error(`release ${next.release_id} has no manifest`);
  try { fs.mkdirSync(LOCK); } catch { throw new Error("another release is being promoted; try again when it finishes"); }
  try {
    const now = readCurrent();
    if ((now?.release_id ?? null) !== expected) throw new Error(`the current release moved to ${now?.release_id ?? "none"} while this build ran from ${expected ?? "none"}; rebuild`);
    const tmp = `${FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 1) + "\n");
    fs.renameSync(tmp, FILE);
  } finally {
    fs.rmdirSync(LOCK);
  }
}
