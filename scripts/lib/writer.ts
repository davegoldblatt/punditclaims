// The only way pipeline code writes public files. A record is validated
// against its strict schema before it touches the repository, so only the
// allowlisted public projection can be written (a strict schema refuses any
// extra field, such as full source text). Paths are confined to data/ and
// research/. Immutable record families are never overwritten with different
// content.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";

const ROOT = path.resolve(process.env.PC_ROOT ?? process.cwd());
const ALLOWED = ["data", "research"].map((d) => path.join(ROOT, d) + path.sep);
const IMMUTABLE = /^data\/(sources\/[^/]+\/versions|source-fetches|reviews|assessments|events|activations|releases|invalidations)\//;
const MAX_PUBLIC_BYTES = 256 * 1024;          // any single record
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;   // a whole release, measured for the full corpus

export function resolveSafe(rel: string): string {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error(`refusing path ${rel}`);
  const abs = path.resolve(ROOT, rel);
  if (!ALLOWED.some((a) => abs.startsWith(a))) throw new Error(`refusing to write outside data/ and research/: ${rel}`);
  // No symlink anywhere on the way down may lead outside the repository.
  let dir = path.dirname(abs);
  while (dir.startsWith(ROOT) && dir !== ROOT) {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${path.relative(ROOT, dir)}`);
    dir = path.dirname(dir);
  }
  if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) throw new Error(`refusing to overwrite a symlink: ${rel}`);
  return abs;
}

export function serialize(rel: string, value: unknown): string {
  return rel.endsWith(".json") ? JSON.stringify(value, null, 1) + "\n" : YAML.stringify(value, { lineWidth: 0 });
}

export function writePublic<T>(rel: string, schema: z.ZodType<T>, record: unknown): T {
  const parsed = schema.safeParse(record);
  if (!parsed.success) throw new Error(`${rel}: not a valid public record: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const body = serialize(rel, parsed.data);
  const limit = /^data\/releases\/[^/]+\/manifest\.json$/.test(rel.replace(/\\/g, "/")) ? MAX_MANIFEST_BYTES : MAX_PUBLIC_BYTES;
  if (Buffer.byteLength(body) > limit) throw new Error(`${rel}: ${Buffer.byteLength(body)} bytes is over the ${limit}-byte limit for this kind of file`);
  const abs = resolveSafe(rel);
  if (fs.existsSync(abs)) {
    const old = fs.readFileSync(abs, "utf8");
    if (old === body) return parsed.data;
    if (IMMUTABLE.test(rel.replace(/\\/g, "/"))) throw new Error(`${rel} is immutable and already exists with different content`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, abs);
  return parsed.data;
}

export const exists = (rel: string) => fs.existsSync(path.resolve(ROOT, rel));
export const readJson = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.resolve(ROOT, rel), "utf8")) as T;
