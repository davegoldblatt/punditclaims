// Who may use the relays under /feeds/.
//
// /feeds/substack-post and /feeds/substack-archive hand back a newsletter's
// public page or listing so the daily update can read them from GitHub's
// runners, which Substack refuses. They exist for that job only. Open to
// everyone they would be a copy of other people's posts on this site and a
// free relay to Substack, so each request must carry a short-lived identity
// token that GitHub issues to a workflow run (OpenID Connect). The token is
// checked here: GitHub's signature, this site as the audience, not expired,
// and issued to a run in this register's own repository. No shared secret is
// stored anywhere. Anything else gets "not found".
//
// /feeds/substack (titles, dates and links only, for the morning email)
// stays open: it serves no post text.
//
// Running your own register: set FEED_REPOSITORY in the Pages project's
// environment to "<owner>/<repository>", or change the default below.
const ISSUER = "https://token.actions.githubusercontent.com";
const DEFAULT_REPOSITORY = "davegoldblatt/punditclaims";
const GUARDED = /^\/feeds\/substack-(post|archive)\//;

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const json = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

let cached = { at: 0, keys: [] };
async function githubKeys() {
  if (Date.now() - cached.at < 3_600_000 && cached.keys.length) return cached.keys;
  const r = await fetch(`${ISSUER}/.well-known/jwks`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error(`GitHub's signing keys answered HTTP ${r.status}`);
  cached = { at: Date.now(), keys: (await r.json()).keys || [] };
  return cached.keys;
}

// Returns the token's claims when it is a valid GitHub Actions identity token
// for `audience`, otherwise null. `keys` is GitHub's published key set.
export async function verifyToken(token, audience, keys, now = Date.now() / 1000) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header, claims;
  try { header = json(h); claims = json(p); } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  if (claims.iss !== ISSUER || claims.aud !== audience) return null;
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;
  return claims;
}

const refuse = () => new Response("not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!GUARDED.test(url.pathname)) return context.next();
  const m = /^Bearer ([A-Za-z0-9_.-]{20,8000})$/.exec(context.request.headers.get("Authorization") || "");
  if (!m) return refuse();
  let claims = null;
  try { claims = await verifyToken(m[1], url.origin, await githubKeys()); } catch { return refuse(); }
  const repository = (context.env && context.env.FEED_REPOSITORY) || DEFAULT_REPOSITORY;
  if (!claims || claims.repository !== repository) return refuse();
  const res = await context.next();
  const out = new Response(res.body, res);
  // The answer is for the one run that asked; no shared cache may keep it.
  out.headers.set("Cache-Control", "private, no-store");
  return out;
}
