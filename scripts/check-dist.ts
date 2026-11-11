// Runs after `astro build` and `pagefind`. Fails the build when the built site
// disagrees with the release it was built from, or cannot be deployed:
// - dist holds more than MAX_FILES files (Cloudflare Pages takes at most
//   20,000 per deployment) or a file larger than MAX_FILE_BYTES (25 MiB);
// - a production build carries fixture ids, "[Synthetic]" text, or the
//   synthetic banner; a fixture build lacks the banner or noindex;
// - a claim or assessment version in the release has no page, or a page
//   exists for something the release does not have;
// - a count shown on a page (data-count + data-n) differs from the release;
// - a register page, a post page, the changes pages, the search index, the
//   JSON exports, the feed, or the sitemap disagrees with the release about
//   which ids exist or where they are listed;
// - a page names a different release, or a canonical URL leaves the origin.
// Expected values are recomputed here from the manifest, not taken from the
// helpers the pages use, so a bug in a page helper cannot hide itself. Only
// the page sizes and the feed length are shared constants.
import { shardOf } from "../src/lib/shard.ts";
import { GROUP_OF, GROUPS, LEVELS, pcts as splitPcts, settledTotal, splitCounts, type Group, type Level } from "../src/lib/split.ts";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { FIXTURE_MODE, release } from "../src/lib/published.ts";
import { SITE } from "../src/site.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "../src/lib/canonical.ts";
import { earliestDay } from "../src/lib/dates.ts";
import { CHANGES_PAGE_SIZE, FEED_ITEMS, PAGE_SIZE } from "../src/lib/listing.ts";
import type { PublicAssessment, PublicClaim } from "../src/lib/manifest.ts";

const MAX_FILES = 19_000;            // Cloudflare Pages: 20,000 files per deployment; keep a margin
const MAX_FILE_BYTES = 25 * 1024 * 1024; // Cloudflare Pages: 25 MiB per file

const DIST = path.resolve(process.argv[2] ?? "dist");
const problems: string[] = [];
const fail = (m: string) => problems.push(m);
const rel = (f: string) => path.relative(DIST, f);

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
const files = walk(DIST);
const read = (f: string) => fs.readFileSync(f, "utf8");
const exists = (p: string) => fs.existsSync(path.join(DIST, p));
const json = (p: string) => JSON.parse(read(path.join(DIST, p)));

if (!files.length) { console.error("check-dist: dist/ is empty; run astro build first"); process.exit(1); }

// --- deployability: file count and file size ------------------------------------------
if (files.length > MAX_FILES) fail(`dist has ${files.length} files; the limit is ${MAX_FILES} (Cloudflare Pages allows 20,000 per deployment)`);
const sizes = files.map((f) => ({ f, n: fs.statSync(f).size }));
for (const s of sizes) if (s.n > MAX_FILE_BYTES) fail(`${rel(s.f)} is ${(s.n / 1048576).toFixed(1)} MiB; the limit is 25 MiB per file`);
const largest = (pred: (f: string) => boolean) => sizes.filter((s) => pred(s.f)).sort((a, b) => b.n - a.n)[0] ?? null;
const biggestFile = largest(() => true);
const biggestPage = largest((f) => f.endsWith(".html"));

const r = release();
const m = r.manifest;
const isLive = (c: PublicClaim) => !!c.current && c.current.status !== "withdrawn";
const live = (m?.claims ?? []).filter(isLive);
const versionsOf = (c: PublicClaim): PublicAssessment[] => {
  const out = new Map<string, PublicAssessment>();
  for (const a of [...c.history, ...(c.current ? [c.current] : [])]) out.set(a.assessment_id, a);
  return [...out.values()];
};
// The assessment a claim page shows: the current one, else the last withdrawn one, else the last.
const shownId = (c: PublicClaim): string | null => {
  if (c.current) return c.current.assessment_id;
  const v = versionsOf(c);
  return ([...v].reverse().find((a) => a.status === "withdrawn") ?? v.at(-1))?.assessment_id ?? null;
};
const sameSet = (a: string[], b: string[]) => { const A = new Set(a); return a.length === b.length && A.size === a.length && b.every((x) => A.has(x)); };

// --- the Pagefind index, decoded -------------------------------------------------
type Fragment = { url: string; content: string; meta: Record<string, string>; anchors?: { element: string; id: string; text: string }[] };
const fragments: Fragment[] = files.filter((f) => f.endsWith(".pf_fragment")).map((f) => {
  const s = zlib.gunzipSync(fs.readFileSync(f)).toString("utf8");
  return JSON.parse(s.slice(s.indexOf("{")));
});
if (!files.some((f) => f.endsWith("pagefind.js"))) fail("the Pagefind index is missing (run pagefind --site dist)");

const html = files.filter((f) => f.endsWith(".html"));
const textFiles = files.filter((f) => /\.(html|json|xml|txt)$/.test(f) || path.basename(f) === "_headers");

// --- release identity, canonicals, fixture isolation ----------------------------
const releaseId = m?.release_id ?? "none";
const pageText = new Map<string, string>();
for (const f of html) {
  const s = read(f);
  pageText.set(f, s);
  const meta = /<meta name="pc:release" content="([^"]*)" data-fixture="(true|false)"/.exec(s);
  if (!meta) fail(`${rel(f)}: no pc:release meta`);
  else {
    if (meta[1] !== releaseId) fail(`${rel(f)}: built from release ${meta[1]}, expected ${releaseId}`);
    if ((meta[2] === "true") !== FIXTURE_MODE) fail(`${rel(f)}: fixture flag ${meta[2]} does not match this build`);
  }
  const canon = /<link rel="canonical" href="([^"]+)"/.exec(s);
  if (!canon || !canon[1].startsWith(`${SITE.origin}/`)) fail(`${rel(f)}: canonical ${canon?.[1] ?? "missing"} is not under ${SITE.origin}`);
  if (FIXTURE_MODE) {
    if (!s.includes("data-synthetic-banner")) fail(`${rel(f)}: fixture build page without the synthetic-preview banner`);
    if (!/<meta name="robots" content="noindex/.test(s)) fail(`${rel(f)}: fixture build page without noindex`);
  }
}
const page = (p: string) => pageText.get(path.join(DIST, p)) ?? "";
const FX = /(^|[^A-Za-z0-9])fx-[a-z0-9]/;
const stripAssets = (s: string) => s.replace(/\/_astro\/[^"'\s)]+/g, "");
if (!FIXTURE_MODE) {
  for (const f of textFiles) {
    const s = stripAssets(pageText.get(f) ?? read(f));
    if (FX.test(s)) fail(`${rel(f)}: contains a fixture id (fx-) in a production build`);
    if (s.includes("[Synthetic]")) fail(`${rel(f)}: contains [Synthetic] text in a production build`);
    if (s.includes("data-synthetic-banner")) fail(`${rel(f)}: carries the synthetic banner in a production build`);
  }
  for (const fr of fragments) if (FX.test(fr.content) || FX.test(JSON.stringify(fr.meta)) || fr.content.includes("[Synthetic]")) fail(`search index: ${fr.url} carries fixture content`);
  if (exists("robots.txt") && !SITE.originExplicit && !/Disallow: \/\s*$/m.test(read(path.join(DIST, "robots.txt")))) fail("robots.txt allows crawling without an explicit PC_SITE_ORIGIN");
} else if (exists("robots.txt") && !/Disallow: \/\s*$/m.test(read(path.join(DIST, "robots.txt")))) fail("robots.txt allows crawling on a fixture build");

if (!exists("404.html")) fail("404.html is missing");

// --- pages for exactly the release's claims, versions, and subjects ------------------
// One page per claim. A version gets its own page only when the claim page does not show it.
const htmlByDir = new Map<string, string[]>();
for (const f of html) { const d = path.relative(DIST, path.dirname(f)); if (!htmlByDir.has(d)) htmlByDir.set(d, []); htmlByDir.get(d)!.push(path.basename(f, ".html")); }
const listHtml = (dir: string) => htmlByDir.get(dir) ?? [];
const claimIds = new Set((m?.claims ?? []).map((c) => c.claim_id));
let versionPages = 0;
for (const c of m?.claims ?? []) {
  if (!exists(`claims/${c.claim_id}.html`)) { fail(`claim ${c.claim_id} has no page`); continue; }
  const shown = shownId(c);
  if (shown && !page(`claims/${c.claim_id}.html`).includes(`id="assessment-${shown}"`)) fail(`claims/${c.claim_id}.html does not carry the anchor of the assessment it shows (${shown})`);
  const own = versionsOf(c).map((a) => a.assessment_id).filter((aid) => aid !== shown);
  versionPages += own.length;
  for (const aid of own) {
    if (!exists(`claims/${c.claim_id}/v/${aid}.html`)) fail(`assessment ${aid} of ${c.claim_id} has no page`);
    if (!page(`claims/${c.claim_id}.html`).includes(`id="assessment-${aid}"`)) fail(`claims/${c.claim_id}.html has no history anchor for ${aid}`);
  }
  const extra = listHtml(`claims/${c.claim_id}/v`).filter((v) => !own.includes(v));
  if (extra.length) fail(`claims/${c.claim_id}/v has pages it should not: ${extra.join(", ")}`);
}
for (const id of listHtml("claims")) if (!claimIds.has(id)) fail(`claims/${id}.html is not a claim in the release`);
if (exists("og/claims")) fail("og/claims exists: share images per claim would add a file per claim");
if (files.some((f) => /^api\/claims\/(?!part-\d+\.json$)[^/]+\.json$/.test(rel(f)))) fail("api/claims/ holds a file per claim; claims are exported in parts");
const subjectIds = new Set((m?.subjects ?? []).map((s) => s.id));
const people = listHtml("people");
if (people.length !== subjectIds.size || people.some((p) => !subjectIds.has(p as never))) fail(`people pages [${people.join(", ")}] are not exactly the release's subjects`);
for (const h of m?.held ?? []) if (exists(`claims/${h.id}.html`)) fail(`held record ${h.id} has a claim page`);

// --- register groups, recomputed ---------------------------------------------------------
const GROUP_IDS = ["checked", "supported", "contradicted", "mixed", "unresolved", "not-yet-due", "uncheckable"];
const inGroup = (c: PublicClaim, g: string): boolean => {
  const o = c.current!.payload.outcome;
  const notDue = c.review.horizon_now === "not_due";
  if (g === "checked") return o !== "not_adjudicable";
  if (g === "uncheckable") return o === "not_adjudicable";
  if (g === "unresolved") return o === "unresolved" && !notDue;
  if (g === "not-yet-due") return o === "unresolved" && notDue;
  return o === g;
};
const ofScope = (s: string) => (s === "all" ? live : live.filter((c) => c.subject_id === s));

// --- counts shown on pages ------------------------------------------------------------
function expected(key: string): number | null {
  if (!m) return null;
  const p = key.split(".");
  const liveOf = (s: string) => live.filter((c) => c.subject_id === s);
  if (p[0] === "counts") {
    // counts.<number> or counts.<map>.<key> or counts.by_subject_outcome.<subject>.<outcome>.
    // The map must exist; a key absent from a map is a count of zero.
    const c = m.counts as unknown as Record<string, unknown>;
    if (p.length === 2) return typeof c[p[1]] === "number" ? (c[p[1]] as number) : null;
    let map = c[p[1]] as Record<string, unknown> | undefined;
    if (p.length === 4 && p[1] === "by_subject_outcome") map = map?.[p[2]] as Record<string, unknown> | undefined;
    else if (p.length !== 3) return null;
    if (!map || typeof map !== "object") return null;
    const leaf = map[p.at(-1)!];
    return typeof leaf === "number" ? leaf : leaf === undefined ? 0 : null;
  }
  if (p[0] === "group" && p.length === 3) {
    if (p[1] !== "all" && !subjectIds.has(p[1] as never)) return null;
    return GROUP_IDS.includes(p[2]) ? ofScope(p[1]).filter((c) => inGroup(c, p[2])).length : null;
  }
  if (p[0] === "probable" && p.length === 4) {
    // probable.<subject>.<level>.<call>: live claims and held records with that probable call (docs/adr/0006).
    if (!subjectIds.has(p[1] as never) || !["reasonable", "speculative"].includes(p[2]) || !["probably_right", "probably_wrong"].includes(p[3])) return null;
    const is = (x: { subject_id: string; probable?: { call: string; level: string } }) => x.subject_id === p[1] && x.probable?.level === p[2] && x.probable.call === p[3];
    return live.filter(is).length + m.held.filter(is).length;
  }
  if (p[0] === "split" && p.length === 5) {
    // split.<subject>.<group>.<level>.<field>: predictions vs. claims about the
    // present or past (docs/plans/predictions-vs-claims.md), recomputed here.
    const [, s, g, level, field] = p;
    if (!subjectIds.has(s as never) || !GROUPS.includes(g as Group) || !LEVELS.includes(level as Level)) return null;
    const x = splitCounts(liveOf(s), m.held.filter((h) => h.subject_id === s), g as Group, level as Level);
    if (field === "total") return settledTotal(x);
    if (field === "pct") return splitPcts(x).supported;
    return field in x ? (x as Record<string, number>)[field] : null;
  }
  if (p[0] === "kindout" && p.length === 4) {
    // kindout.<subject>.<group>.<outcome>: live claims in a kind group with that outcome.
    const [, s, g, o] = p;
    if (!subjectIds.has(s as never) || !GROUPS.includes(g as Group)) return null;
    return liveOf(s).filter((c) => GROUP_OF[c.kind] === g && c.current!.payload.outcome === o).length;
  }
  if (p[0] === "kindcall" && p.length === 5) {
    // kindcall.<subject>.<group>.<level>.<call>: probable calls at exactly that level, live and held.
    const [, s, g, l, call] = p;
    if (!subjectIds.has(s as never) || !GROUPS.includes(g as Group)) return null;
    const is = (x: { subject_id: string; kind?: string; probable?: { call: string; level: string } }) => x.subject_id === s && !!x.kind && GROUP_OF[x.kind as keyof typeof GROUP_OF] === g && x.probable?.level === l && x.probable.call === call;
    return live.filter(is).length + m.held.filter(is).length;
  }
  if (p[0] === "subject" && p.length === 3) {
    const s = p[1];
    if (p[2] === "occurrences") return liveOf(s).reduce((n, c) => n + c.occurrences.length, 0);
    if (p[2] === "held") return m.held.filter((h) => h.subject_id === s).length;
    if (p[2] === "withdrawn") return m.claims.filter((c) => c.subject_id === s && !isLive(c)).length;
  }
  if (p[0] === "subject" && p.length === 4) {
    const [, s, facet, v] = p;
    const pick: Record<string, (c: PublicClaim) => boolean> = {
      kind: (c) => c.kind === v, horizon: (c) => c.review.horizon_now === v, topic: (c) => c.topic_tags.includes(v), outcome: (c) => c.current!.payload.outcome === v,
      // The prediction chart: forecasts and conditional forecasts by outcome, and the open ones by horizon.
      predicted: (c) => /forecast$/.test(c.kind) && c.current!.payload.outcome === v,
      predicted_open: (c) => /forecast$/.test(c.kind) && c.current!.payload.outcome === "unresolved" && c.review.horizon_now === v,
    };
    return pick[facet] ? liveOf(s).filter(pick[facet]).length : null;
  }
  if (p[0] === "topic" && p.length === 2) return live.filter((c) => c.topic_tags.includes(p[1])).length;
  if (p[0] === "coverage" && p.length === 3) {
    const w = m.coverage.find((x) => x.window_id === p[1]);
    const v = w ? (w as Record<string, unknown>)[p[2]] : undefined;
    return typeof v === "number" ? v : null;
  }
  const subst = m.events.filter((e) => e.substantive);
  if (key === "events.substantive") return subst.length;
  if (p[0] === "events" && p[1] === "subject" && p.length === 3) return subst.filter((e) => e.subject_id === p[2]).length;
  if (p[0] === "events" && p[1] === "type" && p.length === 3) return subst.filter((e) => e.type === p[2]).length;
  if (p[0] === "held" && p[1] === "reason" && p.length === 3) return m.held.filter((h) => h.held_reason === p[2]).length;
  return null;
}
// public/_headers sends style-src 'self', so an inline style attribute is
// silently ignored on the live site (the local preview sends no such header).
for (const [f, s] of pageText) if (/<[a-z][^>]*\sstyle="/i.test(s)) fail(`${rel(f)}: has an inline style attribute, which the site's Content-Security-Policy blocks`);

// The Explore index: exactly the live claims, each with its person and current outcome.
if (m) {
  const f = path.join(DIST, "api/explore.json");
  if (!fs.existsSync(f)) fail("api/explore.json is missing");
  else {
    const x = JSON.parse(fs.readFileSync(f, "utf8")) as { claims: { id: string; person: string; outcome: string }[] };
    const want = new Map(m.claims.filter((c) => c.current && c.current.status !== "withdrawn").map((c) => [c.claim_id, c]));
    const seenIds = new Set<string>();
    for (const e of x.claims) {
      const c = want.get(e.id);
      if (!c) fail(`api/explore.json: ${e.id} is not a live claim`);
      else if (e.person !== c.subject_id || e.outcome !== c.current!.payload.outcome || (e as { kind?: string }).kind !== c.kind || JSON.stringify((e as { probable?: unknown }).probable ?? null) !== JSON.stringify(c.probable ?? null)) fail(`api/explore.json: ${e.id} disagrees with the release`);
      if (seenIds.has(e.id)) fail(`api/explore.json: ${e.id} appears twice`);
      seenIds.add(e.id);
    }
    if (seenIds.size !== want.size) fail(`api/explore.json holds ${seenIds.size} claims, the release has ${want.size} live`);
    // Held entries: exactly the held records with a probable call, with that call.
    const heldWant = new Map(m.held.filter((h) => h.probable).map((h) => [h.id, h]));
    const heldGot = (x as unknown as { held?: { id: string; person: string; kind: string; probable: { call: string; level: string } }[] }).held ?? [];
    // Every held probable call needs its kind, or the predictions split would silently drop it.
    for (const h of heldWant.values()) if (!h.kind) fail(`held record ${h.id} has a probable call but no kind`);
    if (heldGot.length !== heldWant.size) fail(`api/explore.json holds ${heldGot.length} held entries, the release has ${heldWant.size} held records with a probable call`);
    for (const e of heldGot) { const h = heldWant.get(e.id); if (!h || h.subject_id !== e.person || (h.kind ?? "") !== e.kind || h.probable!.call !== e.probable.call || h.probable!.level !== e.probable.level) fail(`api/explore.json: held entry ${e.id} disagrees with the release`); }
    // Each live claim's evidence is in the shard the page will fetch for it.
    const shard = new Map<number, Record<string, unknown>>();
    for (const id of want.keys()) {
      const n = shardOf(id);
      if (!shard.has(n)) { const sf = path.join(DIST, `api/evidence/${n}.json`); shard.set(n, fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, "utf8")) : {}); }
      if (!shard.get(n)![id]) fail(`api/evidence/${n}.json: ${id} is missing`);
    }
  }
}

let countsChecked = 0;
const expectedCache = new Map<string, number | null>();
for (const [f, s] of pageText) {
  if (!s.includes("data-count=")) continue;
  for (const tag of s.matchAll(/<([a-z0-9]+)\s([^>]*\bdata-count="[^"]*"[^>]*)>([^<]*)/g)) {
    const attrs = Object.fromEntries([...tag[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const key = attrs["data-count"];
    const n = Number(attrs["data-n"]);
    if (!m) { fail(`${rel(f)}: shows a count (${key}) with no release`); continue; }
    if (!expectedCache.has(key)) expectedCache.set(key, expected(key));
    const want = expectedCache.get(key)!;
    countsChecked++;
    if (want === null) fail(`${rel(f)}: unknown count key ${key}`);
    else if (!Number.isInteger(n) || n !== want) fail(`${rel(f)}: ${key} shows ${attrs["data-n"]}, the release says ${want}`);
    else if (!new RegExp(`(^|\\D)${n}(\\D|$)`).test(tag[3].replace(/(\d),(?=\d{3})/g, "$1"))) fail(`${rel(f)}: ${key} text "${tag[3].trim()}" does not show ${n}`);
  }
}

// --- the register: every group, every page, exactly the right rows in order -----------------
const rowIds = (s: string) => [...s.matchAll(/<li class="row" data-item data-id="([^"]+)"/g)].map((x) => x[1]);
const saidOrder = (a: PublicClaim, b: PublicClaim) => earliestDay(b.first_statement_date).localeCompare(earliestDay(a.first_statement_date)) || a.claim_id.localeCompare(b.claim_id);
const listFile = (scope: string, g: string, n: number): string => {
  const base = scope === "all" ? "" : `people/${scope}`;
  const head = scope === "all" ? `register/${g}` : `${base}/${g}`;
  return n === 1 ? `${head}.html` : `${head}/${n}.html`;
};
let listPages = 0;
if (m) {
  const wanted = new Set<string>();
  for (const scope of ["all", ...subjectIds]) {
    const mine = ofScope(scope).sort(saidOrder);
    for (const g of GROUP_IDS) {
      const rows = mine.filter((c) => inGroup(c, g));
      if (!rows.length && g !== "checked") continue;
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      for (let n = 1; n <= pages; n++) {
        const f = listFile(scope, g, n);
        wanted.add(f);
        listPages++;
        if (!exists(f)) { fail(`${f}: register page missing (${scope}, ${g}, page ${n} of ${pages})`); continue; }
        const want = rows.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE).map((c) => c.claim_id);
        const got = rowIds(page(f));
        if (got.join(" ") !== want.join(" ")) fail(`${f}: register rows do not match ${scope}/${g} page ${n} (${got.length} rows, expected ${want.length})`);
      }
    }
  }
  const listed = files.map(rel).filter((f) => f.endsWith(".html") && (f.startsWith("register/") || /^people\/[^/]+\/.+/.test(f)));
  for (const f of listed) if (!wanted.has(f)) fail(`${f}: a register page the release does not call for`);
} else {
  if (!page("index.html").includes('data-release-state="none"')) fail("index.html: no release, but the page does not show the not-published state");
  if (rowIds(page("index.html")).length) fail("index.html: register rows with no release");
}

// --- post pages: one per source post, listing every claim recorded from it ---------------------
const postKey = (url: string) => { try { const u = new URL(url); return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`; } catch { return url; } };
const claimPosts = new Map<string, Set<string>>(); // post key -> claim ids
for (const c of m?.claims ?? []) {
  const keys = new Set(c.occurrences.map((o) => postKey(o.document.url)));
  const shown = versionsOf(c).find((a) => a.assessment_id === shownId(c));
  if (shown) keys.add(postKey(shown.payload.statement.url));
  for (const k of keys) { if (!claimPosts.has(k)) claimPosts.set(k, new Set()); claimPosts.get(k)!.add(c.claim_id); }
}
const postFiles = html.filter((f) => rel(f).startsWith("posts/"));
const postsSeen = new Set<string>();
for (const f of postFiles) {
  const s = pageText.get(f)!;
  const src = /<a href="([^"]+)" rel="noopener">Read the post at its source<\/a>/.exec(s);
  if (!src) { fail(`${rel(f)}: post page without its source link`); continue; }
  const k = postKey(src[1].replace(/&amp;/g, "&"));
  if (postsSeen.has(k)) fail(`${rel(f)}: a second page for the post ${k}`);
  postsSeen.add(k);
  const want = claimPosts.get(k);
  if (!want) { fail(`${rel(f)}: no claim in the release comes from ${k}`); continue; }
  if (!sameSet(rowIds(s), [...want])) fail(`${rel(f)}: lists ${rowIds(s).length} claims; the release records ${want.size} from this post`);
}
for (const k of claimPosts.keys()) if (!postsSeen.has(k)) fail(`no post page for ${k}`);

// --- changes pages: every substantive event once, newest first ------------------------------
const byNewest = <T extends { recorded_at: string; event_id: string }>(a: T, b: T) => b.recorded_at.localeCompare(a.recorded_at) || b.event_id.localeCompare(a.event_id);
const subst = (m?.events ?? []).filter((e) => e.substantive).sort(byNewest);
if (m) {
  const pages = Math.max(1, Math.ceil(subst.length / CHANGES_PAGE_SIZE));
  for (let n = 1; n <= pages; n++) {
    const f = n === 1 ? "changes.html" : `changes/${n}.html`;
    if (!exists(f)) { fail(`${f}: changes page missing`); continue; }
    const got = [...page(f).matchAll(/<li id="event-[^"]+" data-item data-id="([^"]+)"/g)].map((x) => x[1]);
    const want = subst.slice((n - 1) * CHANGES_PAGE_SIZE, n * CHANGES_PAGE_SIZE).map((e) => e.event_id);
    if (got.join(" ") !== want.join(" ")) fail(`${f}: lists ${got.length} changes, expected ${want.length} in order`);
  }
  if (exists(`changes/${pages + 1}.html`)) fail("changes has more pages than the release calls for");
}

// --- search index: every claim, found through its post --------------------------------------
const indexed = fragments.flatMap((f) => (f.anchors ?? []).map((a) => a.id).filter((id) => id.startsWith("c-")).map((id) => id.slice(2)));
if (!sameSet([...new Set(indexed)], [...claimIds])) fail(`search index: ${new Set(indexed).size} claims are findable; the release has ${claimIds.size}`);
for (const fr of fragments) if (/^\/claims\//.test(fr.url)) fail(`search index: ${fr.url} is a claim page; the index reads post pages`);
for (const h of m?.held ?? []) if (fragments.some((f) => f.content.includes(h.id) || JSON.stringify(f.meta).includes(h.id))) fail(`search index mentions held record ${h.id}`);

// --- JSON exports -------------------------------------------------------------------------
const releaseJson = json("api/release.json");
let parts = 0;
if (m) {
  if (releaseJson.digest !== m.digest || releaseJson.release_id !== m.release_id) fail("api/release.json is not the current release");
  if (!exists(`api/releases/${m.release_id}.json`)) fail("the versioned release export is missing");
  // The parts rebuild the manifest exactly: same claims, same order, same digest.
  const list: { url: string }[] = releaseJson.claims_in_parts?.parts ?? [];
  const rebuilt: PublicClaim[] = [];
  for (const [i, p] of list.entries()) {
    const local = p.url.startsWith(SITE.origin) ? p.url.slice(SITE.origin.length + 1) : null;
    if (!local || !exists(local)) { fail(`api/release.json lists a part that is not built: ${p.url}`); continue; }
    const part = json(local);
    if (part.release_id !== m.release_id || part.digest !== m.digest || part.part !== i + 1) fail(`${local} does not name this release and its place`);
    rebuilt.push(...part.claims);
  }
  parts = list.length;
  const { claims_in_parts: _parts, ...head } = releaseJson;
  if (hashOf({ ...head, claims: rebuilt }, OWN_DIGEST_FIELDS.manifest) !== m.digest) fail("api/release.json and its parts do not rebuild the release manifest (digest differs)");
  const cj = json("api/claims.json");
  if (cj.release_id !== m.release_id || cj.digest !== m.digest) fail("api/claims.json names another release");
  if (JSON.stringify(cj.counts) !== JSON.stringify(m.counts)) fail("api/claims.json counts differ from the release");
  const exported: string[] = [];
  for (const u of cj.claims_in_parts?.parts ?? []) {
    const local = String(u).slice(SITE.origin.length + 1);
    if (!exists(local)) { fail(`api/claims.json lists a part that is not built: ${u}`); continue; }
    const part = json(local);
    if (part.release_id !== m.release_id || part.digest !== m.digest) fail(`${local} names another release`);
    exported.push(...part.claims.map((c: { claim: PublicClaim }) => c.claim.claim_id));
  }
  if (!sameSet(exported, [...claimIds])) fail("the claims export parts do not hold each claim in the release exactly once");
  for (const h of m.held) if (claimIds.has(h.id)) fail(`the claims export would list held record ${h.id} as a claim`);
} else if (releaseJson.release_id !== null) fail("api/release.json names a release that does not exist");

// --- feed and sitemap -------------------------------------------------------------------------
const feed = read(path.join(DIST, "feed.xml"));
const guids = [...feed.matchAll(/<guid isPermaLink="false">punditclaims-event-([^<]+)<\/guid>/g)].map((x) => x[1]);
const feedWant = subst.slice(0, FEED_ITEMS).map((e) => e.event_id);
if (guids.join(" ") !== feedWant.join(" ")) fail(`feed.xml has ${guids.length} items; expected the newest ${feedWant.length} substantive events in order`);

const sitemap = read(path.join(DIST, "sitemap.xml"));
const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]));
for (const l of locs) if (!l.startsWith(`${SITE.origin}/`)) fail(`sitemap.xml: ${l} is not under ${SITE.origin}`);
for (const id of claimIds) if (!locs.has(`${SITE.origin}/claims/${id}`)) fail(`sitemap.xml lacks claim ${id}`);
for (const f of postFiles) { const u = `${SITE.origin}/${rel(f).replace(/\.html$/, "")}`; if (!locs.has(u)) fail(`sitemap.xml lacks post page ${u}`); }

// --- report -----------------------------------------------------------------------------------
const mode = FIXTURE_MODE ? "fixture (synthetic preview)" : m ? "production" : "no release";
const mb = (n: number) => `${(n / 1048576).toFixed(2)} MiB`;
const kb = (n: number) => `${(n / 1024).toFixed(0)} KiB`;
if (problems.length) {
  console.error(`check-dist: ${problems.length} problem(s) in a ${mode} build of release ${releaseId}`);
  for (const p of problems.slice(0, 200)) console.error(`  - ${p}`);
  if (problems.length > 200) console.error(`  ... and ${problems.length - 200} more`);
  process.exit(1);
}
console.log(`check-dist: ok. ${mode} build of release ${releaseId}: ${files.length} files (limit ${MAX_FILES}), ${html.length} pages, ${claimIds.size} claims (${live.length} live), ${versionPages} version pages, ${listPages} register pages, ${postFiles.length} post pages, ${countsChecked} counts, ${fragments.length} indexed pages, ${parts} release parts, ${guids.length} feed items.`);
console.log(`check-dist: largest file ${biggestFile ? `${rel(biggestFile.f)} (${mb(biggestFile.n)})` : "none"}; largest page ${biggestPage ? `${rel(biggestPage.f)} (${kb(biggestPage.n)})` : "none"}.`);
