// /og/site.png: the share image for every page that is not a claim.
import { release, FIXTURE_MODE } from "../../lib/published.ts";
import { renderSiteCard } from "../../og/render.ts";
import { SITE } from "../../site.ts";

export async function GET() {
  const m = release().manifest;
  const host = new URL(SITE.origin).host;
  const line = m ? `${host}. Release of ${m.reference_date}.` : `${host}. Not yet published.`;
  const png = await renderSiteCard({ line, synthetic: FIXTURE_MODE, host });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
}
