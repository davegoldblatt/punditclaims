// /sitemap.xml: every reader page in the release. Claim pages carry the date
// of their last substantive change; held records have no pages. Register and
// change lists are included page by page, and every source post page.
import { release } from "../lib/published.ts";
import { SITE } from "../site.ts";
import { claimPath, day, hasVersionPage, personPath, versionPath, versionsOf } from "../lib/view.ts";
import { CHANGES_PAGE_SIZE, changesPath, listingsFor, listPath, postsFor } from "../lib/listing.ts";

export function GET() {
  const r = release();
  const urls: { loc: string; lastmod?: string }[] = ["/method", "/coverage", "/held", "/about"].map((p) => ({ loc: p }));
  if (r.manifest) {
    for (const scope of [null, ...r.subjects.map((s) => s.id)]) for (const l of listingsFor(r.live, scope)) urls.push({ loc: listPath(scope, l.group, l.page) });
  } else {
    urls.push({ loc: "/" });
    for (const s of r.subjects) urls.push({ loc: personPath(s.id) });
  }
  const changePages = Math.max(1, Math.ceil(r.events.filter((e) => e.substantive).length / CHANGES_PAGE_SIZE));
  for (let p = 1; p <= changePages; p++) urls.push({ loc: changesPath(p) });
  for (const c of r.claims) {
    urls.push({ loc: claimPath(c.claim_id), lastmod: day(c.last_substantive_change_at) });
    for (const a of versionsOf(c)) if (hasVersionPage(c, a.assessment_id)) urls.push({ loc: versionPath(c.claim_id, a.assessment_id), lastmod: day(a.recorded_at) });
  }
  if (r.manifest) for (const p of postsFor(r.claims, r.held)) urls.push({ loc: p.path });
  const body = urls.map((u) => `  <url><loc>${SITE.origin}${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
