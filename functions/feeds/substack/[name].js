// Titles, dates and links from one Substack newsletter's RSS feed, for the
// morning email (scripts/digest.ts). Substack refuses GitHub's runners, so
// the email's gather asks this site instead and Cloudflare fetches the feed.
// Only *.substack.com feeds, and only titles, dates and links: no post text
// is served. Cloudflare caches the feed for 15 minutes.
export async function onRequestGet({ params }) {
  const name = String(params.name || "");
  if (!/^[a-z0-9-]{1,63}$/.test(name)) return new Response("not found", { status: 404 });
  const r = await fetch(`https://${name}.substack.com/feed`, {
    headers: { "User-Agent": "punditclaims-digest/1.0 (+https://punditclaims.ai)" },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  const xml = await r.text();
  const headers = { "Cache-Control": "public, max-age=900", "X-Robots-Tag": "noindex" };
  if (!/<rss|<feed/.test(xml.slice(0, 2000))) return Response.json({ error: `the feed answered HTTP ${r.status} with a web page` }, { status: 502, headers });
  const pick = (s, re) => (re.exec(s) || [])[1] || "";
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((x) => {
    const d = new Date(pick(x[1], /<pubDate>([^<]+)<\/pubDate>/));
    return {
      title: pick(x[1], /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/),
      url: pick(x[1], /<link>([^<]+)<\/link>/),
      date: isNaN(d.getTime()) ? "" : d.toISOString(),
    };
  });
  return Response.json(items, { headers });
}
