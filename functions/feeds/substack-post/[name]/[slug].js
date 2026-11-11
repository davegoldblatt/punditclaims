// One public post page from a Substack newsletter, for the daily update
// (scripts/lib/capture.ts with PC_SUBSTACK_VIA). Substack refuses GitHub's
// runners, so the run asks this site and Cloudflare fetches the same public
// page a reader's browser gets. Only https://<name>.substack.com/p/<slug>,
// GET only, no cookies. Redirects are followed only to another
// https://<x>.substack.com/p/ page. The page comes back as inert plain text
// (never rendered as a page on this site), capped at 5 MB. A paywalled post
// comes back as its public preview, as it does for anyone. Cached 15 minutes.
const SAFE = { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public, max-age=900", "X-Robots-Tag": "noindex" };
const allowed = (u) => u.protocol === "https:" && /^[a-z0-9-]{1,63}\.substack\.com$/.test(u.hostname) && /^\/p\/[a-z0-9-]{1,200}\/?$/.test(u.pathname);
export async function onRequestGet({ params }) {
  const name = String(params.name || "");
  const slug = String(params.slug || "");
  if (!/^[a-z0-9-]{1,63}$/.test(name) || !/^[a-z0-9-]{1,200}$/.test(slug)) return new Response("not found", { status: 404, headers: SAFE });
  let url = new URL(`https://${name}.substack.com/p/${slug}`);
  for (let hop = 0; hop < 4; hop++) {
    // Substack answers a share of requests from Cloudflare with 429 or 5xx
    // (measured 2026-11-09): up to three tries, a second apart.
    let r;
    for (let i = 0; i < 3; i++) {
      r = await fetch(url, { headers: { "User-Agent": "punditclaims-update/1.0 (+https://punditclaims.ai)", Accept: "text/html" }, redirect: "manual", cf: { cacheTtl: 900, cacheEverything: true } });
      if (r.status !== 429 && r.status < 500) break;
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      const next = new URL(r.headers.get("location"), url);
      if (!allowed(next)) return new Response(`redirect to a page outside Substack posts refused`, { status: 502, headers: SAFE });
      url = next; continue;
    }
    const body = await r.text();
    if (body.length > 5_000_000) return new Response("page too large", { status: 502, headers: SAFE });
    return new Response(body, { status: r.status, headers: { ...SAFE, "X-Upstream-Status": String(r.status), "X-Upstream-Url": url.href } });
  }
  return new Response("too many redirects", { status: 502, headers: SAFE });
}
