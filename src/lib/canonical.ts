// Canonical JSON and content hashes. Object keys are sorted, array order is
// kept, strings are kept byte for byte, and numbers must be integers (precise
// decimals such as money are strings). A record's own digest and anything
// downstream of it are excluded from the body that is hashed.
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON carries integers only; write ${value} as a decimal string`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonical JSON cannot carry a ${typeof value}`);
}

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export function hashOf(value: unknown, exclude: readonly string[] = []): string {
  if (exclude.length && value && typeof value === "object" && !Array.isArray(value)) {
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const k of exclude) delete copy[k];
    return sha256(canonicalize(copy));
  }
  return sha256(canonicalize(value));
}

// The fields each record family leaves out of its own hash.
export const OWN_DIGEST_FIELDS = {
  claim: ["content_hash"],
  contract: ["content_hash"],
  packet: ["packet_hash"],
  manifest: ["digest"],
} as const;
