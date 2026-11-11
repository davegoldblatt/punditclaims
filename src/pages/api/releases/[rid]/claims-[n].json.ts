// /api/releases/<release-id>/claims-<n>.json: one part of the release's
// claims, in manifest order. /api/release.json lists every part.
import type { APIContext } from "astro";
import { release } from "../../../../lib/published.ts";
import { partCount, releasePart } from "../../../../lib/exports.ts";

export function getStaticPaths() {
  const m = release().manifest;
  return m ? Array.from({ length: partCount(m.claims.length) }, (_, i) => ({ params: { rid: m.release_id, n: String(i + 1) } })) : [];
}

export function GET({ params }: APIContext) {
  const body = releasePart(release().manifest!, Number(params.n));
  return new Response(JSON.stringify(body) + "\n", { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
