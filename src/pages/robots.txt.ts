// /robots.txt. Crawlers are allowed only on a production build: a real
// release, and an origin set on purpose with PC_SITE_ORIGIN. A preview or a
// synthetic build asks every crawler to stay out, so it never competes with
// or impersonates the eventual production domain.
import { release, FIXTURE_MODE } from "../lib/published.ts";
import { SITE } from "../site.ts";

export function GET() {
  const indexable = !FIXTURE_MODE && SITE.originExplicit && release().manifest !== null;
  const body = indexable
    ? `# Pundit Claims. Data and text CC BY 4.0.\nUser-agent: *\nAllow: /\nDisallow: /search\nSitemap: ${SITE.origin}/sitemap.xml\n`
    : `# Preview or unreleased build: not for indexing.\nUser-agent: *\nDisallow: /\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
