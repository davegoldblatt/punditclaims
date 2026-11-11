// /api/releases/<release-id>.json: the same export as /api/release.json at an
// address that names its release, so a citation can pin the exact data it
// used. Its claims are in /api/releases/<release-id>/claims-<n>.json.
import { release } from "../../../lib/published.ts";
import { releaseHead } from "../../../lib/exports.ts";
import { SITE } from "../../../site.ts";

export function getStaticPaths() {
  const m = release().manifest;
  return m ? [{ params: { rid: m.release_id } }] : [];
}

export function GET() {
  return new Response(JSON.stringify(releaseHead(release().manifest!, SITE.origin), null, 1) + "\n", { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
