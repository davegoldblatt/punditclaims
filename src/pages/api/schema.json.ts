// /api/schema.json: JSON Schema for /api/release.json, generated from the
// zod schema the loader validates against, so the two cannot drift.
import { z } from "zod";
import { ReleaseManifest } from "../../lib/manifest.ts";
import { SITE } from "../../site.ts";

export function GET() {
  const schema = { ...z.toJSONSchema(ReleaseManifest, { unrepresentable: "any" }), $id: `${SITE.origin}/api/schema.json`, title: "Pundit Claims release manifest" };
  return new Response(JSON.stringify(schema, null, 1) + "\n", { headers: { "Content-Type": "application/schema+json; charset=utf-8" } });
}
