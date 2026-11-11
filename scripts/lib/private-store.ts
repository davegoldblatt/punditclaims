// Private storage for what must not be public: full source text, full
// quotations with context, and raw provider responses. It is a directory
// outside git (default .cache/private-sources, or PC_PRIVATE_DIR), files are
// written 0600 and never overwritten. It survives only where that directory
// does; durable private retention needs an authorised store (docs/adr/0002).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const PRIVATE_DIR = path.resolve(process.env.PC_PRIVATE_DIR || ".cache/private-sources");

function writeOnce(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") !== body) throw new Error(`refusing to overwrite private record ${path.relative(PRIVATE_DIR, file)}`);
    return;
  }
  fs.writeFileSync(file, body, { mode: 0o600 });
}

export function putSnapshot(hash: string, text: string, meta: Record<string, unknown>): void {
  if (createHash("sha256").update(text).digest("hex") !== hash) throw new Error("snapshot text does not match its hash");
  const txt = path.join(PRIVATE_DIR, "snapshots", `${hash}.txt`);
  // Identical text seen again: the first observation's metadata stands.
  if (fs.existsSync(txt)) { writeOnce(txt, text); return; }
  writeOnce(txt, text);
  writeOnce(path.join(PRIVATE_DIR, "snapshots", `${hash}.meta.json`), JSON.stringify(meta, null, 1));
}

export function getSnapshot(hash: string): string | null {
  const f = path.join(PRIVATE_DIR, "snapshots", `${hash}.txt`);
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, "utf8");
  if (createHash("sha256").update(text).digest("hex") !== hash) throw new Error(`private snapshot ${hash.slice(0, 12)} is corrupt`);
  return text;
}

export function putPrivateJson(kind: "quotes" | "raw" | "evidence", id: string, body: unknown): void {
  writeOnce(path.join(PRIVATE_DIR, kind, `${id}.json`), JSON.stringify(body, null, 1));
}

export function getPrivateJson<T>(kind: "quotes" | "raw" | "evidence", id: string): T | null {
  const f = path.join(PRIVATE_DIR, kind, `${id}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;
}
