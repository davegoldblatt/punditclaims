// /api/claims/part-<n>.json: one part of the claims export, newest statement
// first, each claim with every assessment version and its addresses here.
import type { APIContext } from "astro";
import { release } from "../../../lib/published.ts";
import { claimsPart, partCount } from "../../../lib/exports.ts";
import { SITE } from "../../../site.ts";

export function getStaticPaths() {
  const m = release().manifest;
  return m ? Array.from({ length: partCount(m.claims.length) }, (_, i) => ({ params: { n: String(i + 1) } })) : [];
}

export function GET({ params }: APIContext) {
  return new Response(JSON.stringify(claimsPart(release().manifest!, Number(params.n), SITE.origin)) + "\n", { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
