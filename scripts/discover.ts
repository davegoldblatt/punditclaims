// node scripts/discover.ts <window-id> [--limit N]
// Discovers every post in a declared collection window (policy/policy.yaml),
// captures each through the safe fetcher, and writes the window's coverage
// manifest to research/coverage/<window>.json. Discovery uses only the
// publication's public listings: the archive listing for a Substack
// publication, the sitemap for Ghost and other sites (config/register.yaml
// says which platform each publication uses). Paywalled posts are captured as
// previews and counted, never read around.
import fs from "node:fs";
import YAML from "yaml";
import { captureUrl, canonicalUrl, documentIdFor, nowStamp } from "./lib/capture.ts";
import { safeFetch } from "./lib/net.ts";
import { feedAuthorization } from "./lib/feed-auth.ts";
import { earliestDay } from "../src/lib/dates.ts";
import { CONFIG } from "../src/config.ts";

type Item = { url: string; title: string | null; listed_date: string | null; listed_date_source: string; listed_access: string | null };
type Row = Item & { document_id: string; published_at: string | null; access_state: string | null; snapshot_hash: string | null; chars: number; status: "captured" | "failed" | "out_of_window"; error: string | null };

const windowId = process.argv[2];
const limitAt = process.argv.indexOf("--limit");
const limit = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity;
const win = CONFIG.subjects.flatMap((s) => s.windows.map((w) => ({ ...w, subject: s.id, platform: s.publications.find((p) => p.origin === w.origin)?.platform ?? "generic" }))).find((w) => w.id === windowId);
if (!win) { console.error(`unknown window ${windowId}`); process.exit(2); }
const inWindow = (d: string | null) => !!d && earliestDay(d.slice(0, 10)) >= win.from && earliestDay(d.slice(0, 10)) <= win.to;

async function substackListing(origin: string): Promise<Item[]> {
  // Substack moved the archive listing from offset paging (a bare array) to
  // cursor paging ({ posts, nextCursor }, at most 25 a page) in November 2026.
  // Both shapes are read, and a repeated cursor or page stops the loop.
  const out: Item[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let offset: number | null = null;
  for (let pageNo = 0; pageNo < 500; pageNo++) {
    const page_ = cursor ? `&cursor=${encodeURIComponent(cursor)}` : offset !== null ? `&offset=${offset}` : "";
    // Substack refuses GitHub's runners: the daily update (PC_SUBSTACK_VIA)
    // reads the same listing through the site's own function.
    const via = process.env.PC_SUBSTACK_VIA;
    const sub = /^https:\/\/([a-z0-9-]+)\.substack\.com$/.exec(origin)?.[1];
    const url = via && sub ? `${via.replace(/\/$/, "")}/feeds/substack-archive/${sub}?x=1${page_}` : `${origin}/api/v1/archive?sort=new&limit=25${page_}`;
    const auth = async () => ({ accept: "application/json", authorization: via && sub ? await feedAuthorization(via) : undefined });
    let r = await safeFetch(url, await auth());
    // 429 and 5xx come and go (the site route sees them from Substack): retry.
    for (let i = 0; i < 4 && !r.ok && (r.status === 429 || r.status >= 500); i++) {
      await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
      r = await safeFetch(url, await auth());
    }
    if (!r.ok) throw new Error(`archive listing failed on page ${pageNo + 1}: ${r.error}`);
    const body = JSON.parse(r.body.toString("utf8")) as any;
    const page: any[] = Array.isArray(body) ? body : Array.isArray(body?.posts) ? body.posts : [];
    if (!Array.isArray(body) && !Array.isArray(body?.posts)) throw new Error(`archive listing on page ${pageNo + 1} has an unknown shape`);
    const fresh = page.filter((p) => !seen.has(String(p.id ?? p.canonical_url)));
    if (!fresh.length) break;
    for (const p of fresh) {
      seen.add(String(p.id ?? p.canonical_url));
      out.push({ url: canonicalUrl(p.canonical_url), title: p.title ?? null, listed_date: p.post_date ?? null, listed_date_source: "Substack archive post_date", listed_access: p.audience ?? null });
    }
    const oldest = page.at(-1)?.post_date;
    if (oldest && oldest.slice(0, 10) < win.from) break;
    // The old shape pages by offset, the new one by cursor.
    if (Array.isArray(body)) { offset = (offset ?? 0) + page.length; continue; }
    const next = body.nextCursor ?? null;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return out;
}

async function sitemapListing(origin: string): Promise<Item[]> {
  const r = await safeFetch(`${origin}/sitemap-posts.xml`, { accept: "application/xml" });
  if (!r.ok) throw new Error(`sitemap failed: ${r.error}`);
  const xml = r.body.toString("utf8");
  return [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ url: canonicalUrl(m[1]), title: null, listed_date: m[2] ?? null, listed_date_source: "sitemap lastmod (uncertain: last modification, not publication)", listed_access: null }));
}

const origin = win.origin.replace(/\/$/, "");
const listing = win.platform === "substack" ? await substackListing(origin) : await sitemapListing(origin);
// A post last modified before the window opened was published before it too.
const candidates = listing.filter((i) => (i.listed_date_source.startsWith("sitemap") ? !i.listed_date || i.listed_date.slice(0, 10) >= win.from : inWindow(i.listed_date)));
console.log(`${win.id}: ${listing.length} listed, ${candidates.length} to capture`);

// The window's earlier manifest. A post it already captured keeps its row:
// the daily update does not fetch it again, and a passing network failure can
// never turn a captured post into a failed one (which would drop its claims
// from the corpus ledger). A post that has left the listing keeps its row too.
// --recapture fetches everything again.
const recapture = process.argv.includes("--recapture");
const prevFile = `research/coverage/${win.id}.json`;
const prev = new Map<string, Row>(!recapture && fs.existsSync(prevFile) ? (JSON.parse(fs.readFileSync(prevFile, "utf8")).items as Row[]).map((r) => [r.document_id, r]) : []);
const rows: Row[] = [];
let n = 0;
for (const item of candidates) {
  const old = prev.get(documentIdFor(item.url));
  if (old && old.snapshot_hash && (old.status === "captured" || old.status === "out_of_window")) { rows.push(old); continue; }
  if (n++ >= limit) break;
  const c = await captureUrl(item.url);
  const doc = fs.existsSync(`data/sources/${c.document_id}/document.yaml`) ? YAML.parse(fs.readFileSync(`data/sources/${c.document_id}/document.yaml`, "utf8")) : null;
  const published = doc?.original_published_at ?? (item.listed_date_source.startsWith("Substack") ? item.listed_date : null);
  const status: Row["status"] = c.error && !c.snapshot_hash ? "failed" : inWindow(published) ? "captured" : "out_of_window";
  rows.push({ ...item, title: doc?.title ?? item.title, document_id: documentIdFor(item.url), published_at: published, access_state: c.access_state, snapshot_hash: c.snapshot_hash, chars: c.text?.length ?? 0, status, error: c.error });
  if (n % 20 === 0) console.log(`  ${n}/${candidates.length}`);
}
for (const [id, old] of prev) if (!rows.some((r) => r.document_id === id)) rows.push(old);
const inside = rows.filter((r) => r.status !== "out_of_window");
const totals = {
  listed: listing.length,
  discovered: inside.length,
  fetched: inside.filter((r) => r.status === "captured").length,
  failed: inside.filter((r) => r.status === "failed").length,
  paywalled: inside.filter((r) => r.access_state === "public_preview").length,
  read_in_full: inside.filter((r) => r.access_state === "full_public").length,
};
fs.mkdirSync("research/coverage", { recursive: true });
fs.writeFileSync(`research/coverage/${win.id}.json`, JSON.stringify({ window: win.id, subject: win.subject, publication: win.publication, from: win.from, to: win.to, generated_at: nowStamp(), discovery: win.platform === "substack" ? "Substack public archive listing" : "sitemap-posts.xml, then each post page for its publication date", limited_to: Number.isFinite(limit) ? limit : null, totals, items: rows }, null, 1) + "\n");
console.log(JSON.stringify(totals));
