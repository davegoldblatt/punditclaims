// The only way this project reads the network. Every request is HTTPS on port
// 443 to a public address. Each redirect hop is re-validated; each hostname is
// resolved once, checked, and the socket connects to exactly that address, so
// a second DNS answer cannot redirect it (no rebinding). Bodies are read as a
// stream and cut off at a byte limit before they are held in memory, and
// decompression has its own output limit. Hosts are rate limited.
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import zlib from "node:zlib";
import type { LookupFunction } from "node:net";

export const UA = "punditclaims-research/1.0 (+https://github.com/davegoldblatt/punditclaims)";

export type Limits = { maxBytes: number; maxDecoded: number; timeoutMs: number; maxRedirects: number; minHostIntervalMs: number };
export const DEFAULT_LIMITS: Limits = { maxBytes: 8 * 1024 * 1024, maxDecoded: 16 * 1024 * 1024, timeoutMs: 30_000, maxRedirects: 5, minHostIntervalMs: 1_500 };

export type FetchResult =
  | { ok: true; url: string; finalUrl: string; status: number; contentType: string | null; lastModified: string | null; body: Buffer; hops: string[] }
  | { ok: false; url: string; finalUrl: string; status: number | null; error: string; hops: string[] };

// Addresses a research fetch must never reach.
export function isBlockedAddress(ip: string): string | null {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0) return "unspecified";
    if (a === 10) return "private";
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link-local or metadata";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT";
    const c = Number(ip.split(".")[2]);
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return "special-purpose";
    if (a === 198 && (b === 18 || b === 19)) return "benchmarking";
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "documentation";
    if (a >= 224) return "multicast or reserved";
    return null;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return "loopback or unspecified";
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (/^f[cd]/.test(x)) return "unique local";
    if (/^fe[89ab]/.test(x)) return "link-local";
    if (/^ff/.test(x)) return "multicast";
    if (x.startsWith("64:ff9b:")) return "translation";
    return null;
  }
  return "not an IP address";
}

export function checkUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "not a URL" }; }
  if (u.protocol !== "https:") return { ok: false, error: "only https is fetched" };
  if (u.username || u.password) return { ok: false, error: "URLs with credentials are refused" };
  if (u.port && u.port !== "443") return { ok: false, error: `port ${u.port} is refused` };
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, ""))) return { ok: false, error: "IP-literal hosts are refused" };
  if (!u.hostname.includes(".") || /\.(local|internal|localhost)$/i.test(u.hostname)) return { ok: false, error: "non-public host name" };
  return { ok: true, url: u };
}

async function resolvePublic(host: string): Promise<{ address: string; family: 4 | 6 }> {
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new Error(`no address for ${host}`);
  for (const a of addrs) {
    const why = isBlockedAddress(a.address);
    if (why) throw new Error(`${host} resolves to a ${why} address`);
  }
  return { address: addrs[0].address, family: addrs[0].family as 4 | 6 };
}

const lastHit = new Map<string, number>();
async function pace(host: string, ms: number) {
  const wait = (lastHit.get(host) ?? 0) + ms - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

function once(u: URL, pinned: { address: string; family: 4 | 6 }, accept: string, lim: Limits, authorization?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  // The socket connects to the address we validated, whatever DNS says now.
  const lookup = ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (opts?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
    else cb(null, pinned.address, pinned.family);
  }) as unknown as LookupFunction;
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname, servername: u.hostname, port: 443, path: u.pathname + u.search, method: "GET", lookup,
      headers: { "User-Agent": UA, Accept: accept, "Accept-Encoding": "gzip, deflate, br", ...(authorization ? { Authorization: authorization } : {}) }, timeout: lim.timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > lim.maxBytes) { res.destroy(); reject(new Error(`body of ${declared} bytes is over the ${lim.maxBytes}-byte limit`)); return; }
      res.on("data", (c: Buffer) => {
        n += c.length;
        if (n > lim.maxBytes) { res.destroy(); reject(new Error(`body exceeded the ${lim.maxBytes}-byte limit`)); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        let body = Buffer.concat(chunks);
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        try {
          const opts = { maxOutputLength: lim.maxDecoded };
          if (enc === "gzip") body = zlib.gunzipSync(body, opts);
          else if (enc === "deflate") body = zlib.inflateSync(body, opts);
          else if (enc === "br") body = zlib.brotliDecompressSync(body, opts);
        } catch (err) { reject(new Error(`decompression failed or exceeded ${lim.maxDecoded} bytes: ${(err as Error).message}`)); return; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timed out after ${lim.timeoutMs} ms`)));
    req.on("error", reject);
    req.end();
  });
}

// `authorization` goes only to the host first asked, never on to a redirect
// target on another host.
export async function safeFetch(raw: string, opts: { accept?: string; limits?: Partial<Limits>; authorization?: string } = {}): Promise<FetchResult> {
  const lim = { ...DEFAULT_LIMITS, ...opts.limits };
  const accept = opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5";
  const hops: string[] = [];
  let current = raw;
  for (let i = 0; i <= lim.maxRedirects; i++) {
    const c = checkUrl(current);
    if (!c.ok) return { ok: false, url: raw, finalUrl: current, status: null, error: c.error, hops };
    hops.push(c.url.toString());
    let r;
    try {
      const pinned = await resolvePublic(c.url.hostname);
      await pace(c.url.hostname, lim.minHostIntervalMs);
      const first = checkUrl(raw);
      r = await once(c.url, pinned, accept, lim, opts.authorization && first.ok && first.url.host === c.url.host ? opts.authorization : undefined);
    } catch (err) {
      return { ok: false, url: raw, finalUrl: current, status: null, error: (err as Error).message.slice(0, 300), hops };
    }
    const loc = r.headers.location;
    if (r.status >= 300 && r.status < 400 && typeof loc === "string") { current = new URL(loc, current).toString(); continue; }
    if (r.status < 200 || r.status >= 300) return { ok: false, url: raw, finalUrl: current, status: r.status, error: `HTTP ${r.status}`, hops };
    const h = (k: string) => (typeof r.headers[k] === "string" ? (r.headers[k] as string) : null);
    return { ok: true, url: raw, finalUrl: current, status: r.status, contentType: h("content-type"), lastModified: h("last-modified"), body: r.body, hops };
  }
  return { ok: false, url: raw, finalUrl: current, status: null, error: `more than ${lim.maxRedirects} redirects`, hops };
}
