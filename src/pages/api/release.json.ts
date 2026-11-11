// /api/release.json: the release manifest as the loader verified it, with its
// claims split into parts (see src/lib/exports.ts) so that no file is too
// large to serve. Join the parts' claims arrays in order to rebuild the
// manifest; its digest matches the rebuilt manifest. With no release, a plain
// "not published" marker.
import { release } from "../../lib/published.ts";
import { NOT_PUBLISHED, releaseHead } from "../../lib/exports.ts";
import { SITE } from "../../site.ts";

export function GET() {
  const m = release().manifest;
  return new Response(JSON.stringify(m ? releaseHead(m, SITE.origin) : NOT_PUBLISHED, null, 1) + "\n", { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
