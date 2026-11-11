// One page of a Substack newsletter's public archive listing, for the daily
// update (scripts/discover.ts with PC_SUBSTACK_VIA). Substack refuses GitHub's
// runners, so the run asks this site and Cloudflare fetches the listing.
// Only *.substack.com, only the archive API, only the paging parameters.
// Cached for 15 minutes.
export async function onRequestGet({ params, request }) {
  const name = String(params.name || "");
  if (!/^[a-z0-9-]{1,63}$/.test(name)) return new Response("not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const out = new URLSearchParams({ sort: "new", limit: "25" });
  const cursor = q.get("cursor");
  if (cursor && /^[A-Za-z0-9+/=_-]{1,400}$/.test(cursor)) out.set("cursor", cursor);
  const offset = q.get("offset");
  if (offset && /^\d{1,5}$/.test(offset)) out.set("offset", offset);
  // Substack answers a share of requests from Cloudflare with 429 or 5xx
  // (measured 2026-11-09): up to three tries, a second apart.
  let r;
  for (let i = 0; i < 3; i++) {
    r = await fetch(`https://${name}.substack.com/api/v1/archive?${out}`, {
      headers: { "User-Agent": "punditclaims-update/1.0 (+https://punditclaims.ai)", Accept: "application/json" },
      redirect: "manual",
      cf: { cacheTtl: 900, cacheEverything: true },
    });
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  const headers = { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public, max-age=900", "X-Robots-Tag": "noindex" };
  if (r.status >= 300 && r.status < 400) return Response.json({ error: `the listing redirected (HTTP ${r.status}); not followed` }, { status: 502, headers });
  const body = await r.text();
  if (body.length > 2_000_000) return Response.json({ error: "listing too large" }, { status: 502, headers });
  if (!/^\s*[[{]/.test(body)) return Response.json({ error: `the listing answered HTTP ${r.status} with a web page` }, { status: 502, headers });
  return new Response(body, { status: r.status, headers });
}
