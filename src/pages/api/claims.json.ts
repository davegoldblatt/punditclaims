// /api/claims.json: the index of the claims export. Every claim in the release
// (withdrawn ones included, marked by `standing`) is in one of the parts it
// lists, newest statement first, each with its addresses on this site. This
// file carries the release identity, counts, coverage, and the held list.
// Counts describe live claims, as every page does.
import { release } from "../../lib/published.ts";
import { claimsPartPath, NOT_PUBLISHED, PART_SIZE, partCount, releaseIdentity } from "../../lib/exports.ts";
import { SITE } from "../../site.ts";

export function GET() {
  const r = release();
  const m = r.manifest;
  const n = partCount(r.claims.length);
  const body = m
    ? {
        ...releaseIdentity(m),
        manifest_url: `${SITE.origin}/api/releases/${m.release_id}.json`,
        schema_url: `${SITE.origin}/api/schema.json`,
        counts: m.counts,
        coverage: m.coverage,
        claims_in_parts: {
          note: `Every claim, newest statement first, in parts of up to ${PART_SIZE}.`,
          total: r.claims.length,
          parts: Array.from({ length: n }, (_, i) => `${SITE.origin}${claimsPartPath(i + 1)}`),
        },
        held: m.held,
      }
    : NOT_PUBLISHED;
  return new Response(JSON.stringify(body, null, 1) + "\n", { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
