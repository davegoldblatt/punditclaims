// The morning email's facts, gathered with no model. A GitHub workflow runs
// this every morning (.github/workflows/digest.yml), so the email does not
// depend on the Mac being awake. Writes latest.json, latest.md (the facts in
// plain words) and latest.html (the designed email with two empty slots) to
// .runs/digest/. With --push, commits those files and the snapshot to the
// `digest` branch, where a scheduled Claude routine reads them, writes the
// note, and sends the email from Dave's Gmail. The branch shares no history
// with main, and the commit message tells Cloudflare not to build it.
//
//   node scripts/digest.ts [--push] [--baseline-release <id>]
//   node scripts/digest.ts --push-only     (push the files already written)
//
// What changed is measured against a snapshot of the site that each run
// stores on the digest branch (digest/snapshot.json). --baseline-release
// seeds that snapshot from an older release when there is none yet.
// Grading runs in the daily update on GitHub, so the work section counts
// the review records saved to the repository. On GitHub there is no loop to report on
// and no usage-limit log, so those lines only appear in a run on the Mac.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { answerFor } from "../src/lib/answer.ts";
import { pcts } from "../src/lib/split.ts";
import { OUTCOME_LABEL, type Outcome } from "../src/policy.ts";
import { CONFIG, joinNames } from "../src/config.ts";
import { renderHtml, type DigestForHtml, type Example, type Post, type Traffic } from "./lib/digest-html.ts";

const SITE = (process.env.PC_SITE_ORIGIN || "https://punditclaims.ai").replace(/\/+$/, "");
const OUT = ".runs/digest";
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const push = argv.includes("--push");
const ON_GITHUB = process.env.GITHUB_ACTIONS === "true";
const now = new Date();
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const notes: string[] = [];

type Manifest = {
  release_id: string;
  subjects: { id: string; name: string }[];
  claims: { claim_id: string; subject_id: string; first_statement_date: string; occurrences: { excerpt: string }[]; current: { payload: { outcome: Outcome } } | null; probable?: { call: string; level: string } }[];
  held: { id: string; subject_id: string; probable?: { call: string; level: string } }[];
};
type Snapshot = { generated_at: string; release_id: string; claims: Record<string, string>; held: Record<string, string>; settled: Record<string, number>; answers?: Record<string, string> };

const readManifest = (id: string): Manifest => JSON.parse(fs.readFileSync(`data/releases/${id}/manifest.json`, "utf8"));
const releaseTime = (id: string) => id.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z.*$/, "$1-$2-$3T$4:$5:$6Z");
const SETTLED = new Set(["supported", "mixed", "contradicted"]);
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n) > n * 0.6 ? s.lastIndexOf(" ", n) : n).replace(/[\s,;:.]+$/, "")}…`);
const callCode = (p?: { call: string }) => (p ? (p.call === "probably_right" ? "r" : "w") : "");

// Each person's answer in words, as the home page shows it by default.
function answersOf(m: Manifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of m.subjects) {
    const k = { supported: 0, mixed: 0, contradicted: 0 };
    for (const c of m.claims) { if (c.subject_id !== s.id) continue; const o = c.current?.payload.outcome; if (o === "supported" || o === "mixed" || o === "contradicted") k[o]++; }
    out[s.id] = answerFor(k).replace(/\.$/, "");
  }
  return out;
}

function snapshotOf(m: Manifest, at: string): Snapshot {
  const claims: Record<string, string> = {};
  const settled: Record<string, number> = {};
  for (const c of m.claims) {
    const o = c.current?.payload.outcome ?? "none";
    claims[c.claim_id] = `${o}|${callCode(c.probable)}`;
    if (SETTLED.has(o)) settled[c.subject_id] = (settled[c.subject_id] ?? 0) + 1;
  }
  const held: Record<string, string> = {};
  for (const h of m.held) held[h.id] = callCode(h.probable);
  return { generated_at: at, release_id: m.release_id, claims, held, settled, answers: answersOf(m) };
}

function run(cmd: string, args: string[], timeoutMs = 600_000): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n[error: ${r.error.message}]` : ""}${r.status ? `\n[exit ${r.status}]` : ""}${r.signal ? `\n[signal ${r.signal}]` : ""}`;
}

const git = (args: string[], env: NodeJS.ProcessEnv = {}) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }).trim();
// The digest branch's last commit, or null before the first digest.
const fetchDigest = (): string | null => { try { git(["fetch", "-q", "origin", "digest"]); return git(["rev-parse", "FETCH_HEAD"]); } catch { return null; } };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const pointer = JSON.parse(fs.readFileSync("data/current-release.json", "utf8")) as { release_id: string };
  const m = readManifest(pointer.release_id);
  const snapFile = path.join(OUT, "snapshot.json");
  const base = opt("--baseline-release");
  // The last email's snapshot lives on the digest branch, so a fresh checkout
  // on GitHub compares with the same morning a run on the Mac would.
  const tip = fetchDigest();
  let stored: string | null = null;
  if (tip) { try { stored = git(["show", `${tip}:digest/snapshot.json`]); } catch { /* no snapshot on the branch yet */ } }
  if (!stored && fs.existsSync(snapFile)) stored = fs.readFileSync(snapFile, "utf8");
  let prev: Snapshot | null = stored ? JSON.parse(stored) : null;
  if (!prev && base) prev = snapshotOf(readManifest(base), releaseTime(base));
  const since = prev ? new Date(prev.generated_at) : new Date(now.getTime() - 24 * 3600_000);
  const cur = snapshotOf(m, stamp(now));

  // The answer per person, as the home page shows it by default. The email
  // mentions it only when it changes (Dave, 2026-11-01: it "will not change
  // much from day to day").
  const people = m.subjects.map((s) => {
    const mine = m.claims.filter((c) => c.subject_id === s.id);
    const k = { supported: 0, mixed: 0, contradicted: 0 };
    for (const c of mine) { const o = c.current?.payload.outcome; if (o === "supported" || o === "mixed" || o === "contradicted") k[o]++; }
    const settled = k.supported + k.mixed + k.contradicted;
    return { id: s.id, name: s.name, published: mine.length, held: m.held.filter((h) => h.subject_id === s.id).length, answer: answerFor(k).replace(/\.$/, ""), answerWas: prev?.answers?.[s.id] ?? null, settled, ...k, pct: pcts(k), settledChange: prev ? settled - (prev.settled[s.id] ?? 0) : null };
  });

  // What changed on the site since the last email.
  const nameOf = new Map(m.subjects.map((s) => [s.id, s.name]));
  const changes = { published: 0, held: 0, unheld: 0, flipped: 0, settled: 0, calls: 0, lastUpdate: null as string | null };
  const flips: Example[] = [];
  const fresh: Example[] = [];
  if (prev) {
    if (prev.release_id !== m.release_id) changes.lastUpdate = releaseTime(m.release_id);
    for (const c of m.claims) {
      const [o, call] = cur.claims[c.claim_id].split("|");
      const before = prev.claims[c.claim_id];
      const [po, pcall] = before ? before.split("|") : [null, prev.held[c.claim_id] ?? ""];
      if (!before) { changes.published++; if (c.claim_id in prev.held) changes.unheld++; }
      if (call && call !== pcall) changes.calls++;
      if (!SETTLED.has(o) || o === po) continue;
      changes.settled++;
      const ex: Example = { person: nameOf.get(c.subject_id) ?? c.subject_id, quote: clip((c.occurrences[0]?.excerpt ?? "").replace(/\s+/g, " "), 180), said: c.first_statement_date, now: OUTCOME_LABEL[o as Outcome], was: po && po !== "none" ? OUTCOME_LABEL[po as Outcome] : null, url: `${SITE}/claims/${c.claim_id}` };
      if (po) { changes.flipped++; flips.push(ex); } else fresh.push(ex);
    }
    for (const h of m.held) {
      if (!(h.id in prev.held)) changes.held++;
      const call = cur.held[h.id];
      if (call && call !== (prev.held[h.id] ?? prev.claims[h.id]?.split("|")[1] ?? "")) changes.calls++;
    }
  }
  const examples = [...flips, ...fresh].slice(0, 6);

  // Grading work since the last email, from the review records. On GitHub
  // these are the records saved to the repository so far, and every file
  // has the checkout's time, so the time filter below passes them all.
  const KIND: Record<string, string> = { batch_review: "claims checked by both AIs", assessment_review: "claims checked by both AIs", batch_final_text: "rewrites checked", batch_probable: "probably right or wrong checks", screen: "claims screened" };
  const claimsBy = new Map<string, Set<string>>();
  let failed = 0;
  let lastSaved = "";
  for (const f of fs.readdirSync("data/reviews")) {
    const p = path.join("data/reviews", f);
    if (fs.statSync(p).mtime < since) continue;
    const r = JSON.parse(fs.readFileSync(p, "utf8")) as { kind: string; status: string; completed_at: string; input_hashes: Record<string, string>; run_id: string };
    if (r.completed_at && new Date(r.completed_at) > new Date(lastSaved || 0)) lastSaved = r.completed_at;
    if (new Date(r.completed_at) < since) continue;
    if (r.status !== "ok") { failed++; continue; }
    const label = KIND[r.kind] ?? r.kind;
    const ids = Object.keys(r.input_hashes ?? {}).filter((k) => k.startsWith("case:")).map((k) => k.slice(5));
    const set = claimsBy.get(label) ?? new Set<string>();
    for (const id of ids.length ? ids : [r.run_id]) set.add(id);
    claimsBy.set(label, set);
  }
  let graded = 0;
  for (const line of fs.readFileSync("research/corpus/grade-log.jsonl", "utf8").split("\n")) {
    if (!line.includes('"stage":"ingest"')) continue;
    const at = /"at":"([^"]+)"/.exec(line)?.[1];
    if (at && new Date(at) >= since) graded++;
  }
  const work = [...(graded ? [{ label: "claims graded", count: graded }] : []), ...[...claimsBy].map(([label, s]) => ({ label, count: s.size })).sort((a, b) => b.count - a.count)];
  const workNote = failed ? [`${failed} call${failed === 1 ? "" : "s"} failed and will be retried.`] : [];

  // Usage limits, logged by the subscription calls with their time.
  const limits: string[] = [];
  if (fs.existsSync(".runs/limits.jsonl")) {
    const seen = new Set<string>();
    for (const line of fs.readFileSync(".runs/limits.jsonl", "utf8").split("\n").filter(Boolean)) {
      const l = JSON.parse(line) as { at: string; provider: string; account: string };
      if (new Date(l.at) < since) continue;
      const who = `${l.provider === "anthropic" ? "Claude" : "ChatGPT"} (${/personal/.test(l.account) ? "personal" : "work"} account)`;
      const hour = new Date(l.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
      const key = `${who}|${hour.slice(0, -3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      limits.push(`${who} hit its usage limit at ${hour} PT.`);
    }
  }

  // What is running right now, when this runs on the Mac.
  const ps = ON_GITHUB ? "" : run("/bin/ps", ["-axo", "command"]);
  const loops = [/\.runs\/review-loop\.sh/.test(ps) ? "the reviews-and-rewrites loop" : null, /scripts\/drive\.sh/.test(ps) ? "the full loop" : null].filter(Boolean);
  const stages = [...new Set([...ps.matchAll(/scripts\/(grade|review-batch|revise|probable|screen|fix|extract|discover)\.ts/g)].map((x) => x[1]))];
  const STAGE: Record<string, string> = { grade: "grading", "review-batch": "reviews", revise: "rewrites", probable: "probably right or wrong", screen: "screening", fix: "fixes", extract: "extraction", discover: "discovery" };
  const loop = ON_GITHUB ? "" : loops.length
    ? `Running now: ${loops.join(" and ")}, restarting every 15 minutes${stages.length ? `. Working at this moment: ${stages.map((s) => STAGE[s]).join(", ")}.` : ", with nothing to do at this moment."}`
    : stages.length ? `No loop is running, but these are: ${stages.map((s) => STAGE[s]).join(", ")}.` : "Nothing is running on the Mac.";

  // What is queued, from count-only runs of each stage, then a dry run of the
  // next site update.
  const node = process.execPath;
  const pending = (script: string) => { const out = run(node, ["--no-warnings", `scripts/${script}.ts`, "--limit", "0"]); const x = /pending: (\d+) claims/.exec(out); return x ? Number(x[1]) : null; };
  const waiting: DigestForHtml["waiting"] = [];
  const rv = pending("review-batch"), rw = pending("revise"), pr = pending("probable");
  waiting.push({ count: rv, text: rv == null ? "Could not count the claims waiting for review." : "claims waiting for both AIs to check them" });
  waiting.push({ count: rw, text: rw == null ? "Could not count the rewrites waiting." : "held-back claims waiting for a rewrite" });
  waiting.push({ count: pr, text: pr == null ? "Could not count the probably right or wrong calls waiting." : "claims waiting for a probably right or wrong call" });
  // A preview can race a stage that is writing its records: try twice.
  const PREVIEW = /: (\d+) published \(([^)]*)\), (\d+) held/;
  let dry = run(node, ["--no-warnings", "scripts/release.ts", "--dry-run"], 900_000);
  if (!PREVIEW.test(dry)) { run("/bin/sleep", ["90"]); dry = run(node, ["--no-warnings", "scripts/release.ts", "--dry-run"], 900_000); }
  const dm = PREVIEW.exec(dry);
  if (!dm) notes.push(`The preview of the next site update failed: ${dry.trim().split("\n").filter((l) => l.trim() && !/^(PUBLISH|HOLD)/.test(l)).slice(-3).join(" ").slice(0, 300)}`);
  let update: { published: number; held: number } | null = null;
  if (!dm) waiting.push({ count: null, text: "Could not preview the next site update." });
  else {
    update = { published: Number(dm[1]) - m.claims.length, held: Number(dm[3]) - m.held.length };
    waiting.push({ count: null, text: update.published || update.held ? `Work not on the site yet: an update now would change claims on the site by ${update.published >= 0 ? "+" : ""}${update.published} and held back by ${update.held >= 0 ? "+" : ""}${update.held}.` : "The site is up to date with the work done." });
  }

  // New posts from each person's publications after the register's cutoff.
  const cutoff = CONFIG.retrieval_cutoff;
  const posts: Post[] = [];
  const postCounts: DigestForHtml["postCounts"] = [];
  const UA = { "User-Agent": "punditclaims-digest/1.0 (+https://punditclaims.ai)" };
  // Substack answers GitHub's runners with a 403 web page on both the archive
  // list and the feed, so the last try asks this site, whose endpoint
  // (functions/feeds/substack) fetches the feed from Cloudflare's network.
  const readSubstack = async (origin: string) => {
    const tried: string[] = [];
    try {
      const r = await fetch(`${origin}/api/v1/archive?sort=new&offset=0&limit=30`, { headers: UA, signal: AbortSignal.timeout(30_000) });
      return (JSON.parse(await r.text()) as { title: string; post_date: string; canonical_url: string }[]).map((p) => ({ title: p.title, date: p.post_date, url: p.canonical_url }));
    } catch (e) { tried.push(`archive: ${(e as Error).message.slice(0, 80)}`); }
    try { return await readRss(`${origin}/feed`); } catch (e) { tried.push(`feed: ${(e as Error).message}`); }
    const sub = /^([a-z0-9-]+)\.substack\.com$/.exec(new URL(origin).hostname)?.[1];
    if (sub) {
      try {
        const r = await fetch(`${SITE}/feeds/substack/${sub}`, { headers: UA, signal: AbortSignal.timeout(30_000) });
        const j = (await r.json()) as { title: string; date: string; url: string }[] | { error: string };
        if (!Array.isArray(j)) throw new Error(j.error);
        return j.filter((p) => p.date);
      } catch (e) { tried.push(`through the site: ${(e as Error).message}`); }
    }
    throw new Error(tried.join("; "));
  };
  const readRss = async (url: string) => {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) });
    const xml = await r.text();
    if (!/<rss|<feed/.test(xml.slice(0, 2000))) throw new Error(`the site sent a web page instead of its feed (HTTP ${r.status})`);
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((x) => ({ title: (/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(x[1]) ?? [])[1] ?? "", url: (/<link>([^<]+)<\/link>/.exec(x[1]) ?? [])[1] ?? "", date: new Date((/<pubDate>([^<]+)<\/pubDate>/.exec(x[1]) ?? [])[1] ?? 0).toISOString() }));
  };
  for (const subj of CONFIG.subjects) {
    let after = 0;
    for (const pub of subj.publications) {
      try {
        let items: { title: string; date: string; url: string }[] = [];
        if (pub.platform === "substack") items = await readSubstack(pub.origin);
        else if (pub.platform === "ghost") {
          items = await readRss(`${pub.origin}/rss/`);
        } else { notes.push(`${pub.name}: no feed reader for this kind of site.`); continue; }
        for (const it of items.filter((p) => p.date.slice(0, 10) > cutoff)) { after++; posts.push({ person: subj.name, title: it.title, date: it.date, url: it.url, isNew: new Date(it.date) >= since }); }
      } catch (e) { notes.push(`Could not read ${pub.name}: ${(e as Error).message}`); }
    }
    postCounts.push({ person: subj.name, sinceCutoff: after, cutoff });
  }
  const firstNames = joinNames(CONFIG.subjects.map((x) => x.name.split(" ")[0]));
  const traffic = await readTraffic(since);

  const facts = {
    generated_at: stamp(now), since: stamp(since), site: SITE, release: m.release_id, first_run: !prev,
    people, totals: { published: m.claims.length, held: m.held.length }, changes, examples, work, failed, last_saved: lastSaved || null, limits, loop, waiting, update, posts, postCounts, traffic, notes,
  };
  const htmlInput: DigestForHtml = {
    generated_at: facts.generated_at, site: SITE, firstRun: !prev, people, totals: facts.totals,
    changes: { ...changes, updates: changes.lastUpdate ? 1 : 0 }, examples, work, workNote, lastSaved: lastSaved || null, loop, limits, waiting, posts, postCounts, postsHeading: `New from ${firstNames}`, traffic,
  };
  fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify(facts, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "latest.md"), render(facts, htmlInput));
  fs.writeFileSync(path.join(OUT, "latest.html"), renderHtml(htmlInput));
  fs.writeFileSync(snapFile, JSON.stringify(cur) + "\n");
  console.log(render(facts, htmlInput));
  if (push) pushDigest();
}

// Site traffic from Cloudflare, read with a read-only analytics token kept
// in the Mac's keychain (service "punditclaims-cf-analytics"). Two sources:
// Web Analytics, which counts real visitors in their browsers (bots left
// out), when it is on for the site; and the zone's own counts of everything
// it served, bots included, which exist without any setup.
async function readTraffic(since: Date): Promise<Traffic> {
  const out: Traffic = { connected: false, people: null, days: [], notes: [] };
  const kc = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "punditclaims-cf-analytics", "-w"], { encoding: "utf8" });
  const token = (kc.status === 0 ? kc.stdout.trim() : "") || process.env.CF_ANALYTICS_TOKEN || "";
  if (!token) return out;
  out.connected = true;
  const host = new URL(SITE).hostname;
  const api = async (pathname: string) => { const r = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) }); const j = (await r.json()) as { success: boolean; result: { id: string }[]; errors?: { message: string }[] }; if (!j.success) throw new Error(j.errors?.map((e) => e.message).join("; ") || `HTTP ${r.status}`); return j.result; };
  const gql = async (query: string, variables: Record<string, unknown>) => { const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) }); const j = (await r.json()) as { data?: any; errors?: { message: string }[] | null }; if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join("; ")); return j.data; };
  const hosts = [host, `www.${host}`];
  let zone: { id: string; account?: { id: string } } | undefined;
  try {
    [zone] = await api(`/zones?name=${host}`);
    if (!zone) throw new Error(`no zone named ${host} is visible to the token`);
    const end = new Date(), start = new Date(end.getTime() - 7 * 24 * 3600_000);
    const d = await gql(`query($zone: String!, $start: Date!, $end: Date!) { viewer { zones(filter: {zoneTag: $zone}) { httpRequests1dGroups(limit: 8, orderBy: [date_ASC], filter: {date_geq: $start, date_leq: $end}) { dimensions { date } sum { pageViews requests } uniq { uniques } } } } }`, { zone: zone.id, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    out.days = (d.viewer.zones[0]?.httpRequests1dGroups ?? []).map((g: any) => ({ date: g.dimensions.date, pageViews: g.sum.pageViews, requests: g.sum.requests, uniques: g.uniq.uniques }));
  } catch (e) { out.notes.push(`Could not read Cloudflare's own counts: ${(e as Error).message}`); }
  // Real-visitor numbers count only pages that run Cloudflare's counter.
  // Cloudflare adds the counter to pages it serves to real browsers (not to
  // this script), and the site's Content-Security-Policy must allow it. When
  // the live policy does not, any count is a stray, so say the counting is
  // off instead of showing it. bot: 0 leaves out headless browsers that run
  // the counter. The window is one day: Cloudflare returns nothing, with no
  // error, for recent ranges much over a week.
  let counterOn = false;
  try { counterOn = ((await fetch(`${SITE}/`, { method: "HEAD", signal: AbortSignal.timeout(30_000) })).headers.get("content-security-policy") ?? "").includes("cloudflareinsights.com"); } catch { /* treated as off */ }
  if (!counterOn) { out.notes.push("Real-visitor counting is not switched on for the site yet, so only Cloudflare's own counts (bots included) are shown."); return out; }
  try {
    const accountId = zone?.account?.id;
    if (!accountId) throw new Error("the token cannot see the site's account");
    const v = { account: accountId, start: stamp(since), end: stamp(new Date()), hosts };
    const d = await gql(`query($account: String!, $start: Time!, $end: Time!, $hosts: [String!]) { viewer { accounts(filter: {accountTag: $account}) {
      total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end, requestHost_in: $hosts, bot: 0}) { count sum { visits } }
      pages: rumPageloadEventsAdaptiveGroups(limit: 8, orderBy: [count_DESC], filter: {datetime_geq: $start, datetime_lt: $end, requestHost_in: $hosts, bot: 0}) { count dimensions { requestPath } }
      refs: rumPageloadEventsAdaptiveGroups(limit: 6, orderBy: [count_DESC], filter: {datetime_geq: $start, datetime_lt: $end, requestHost_in: $hosts, bot: 0}) { count dimensions { refererHost } } } } }`, v);
    const acc = d.viewer.accounts[0];
    const total = acc?.total?.[0];
    if (total && total.count > 0) out.people = { pageviews: total.count, visits: total.sum.visits, pages: acc.pages.map((x: any) => ({ path: x.dimensions.requestPath, views: x.count })), referrers: acc.refs.filter((x: any) => x.dimensions.refererHost && !hosts.includes(x.dimensions.refererHost)).map((x: any) => ({ host: x.dimensions.refererHost, views: x.count })) };
  } catch (e) { out.notes.push(`Could not read real-visitor numbers: ${(e as Error).message}`); }
  return out;
}

// Plain words for the model: no ids, no pipeline vocabulary, no file names.
function render(f: { generated_at: string; since: string; first_run: boolean; notes: string[]; update: { published: number; held: number } | null; changes: { lastUpdate: string | null } }, d: DigestForHtml): string {
  const pt = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const L: string[] = [];
  L.push(`Pundit Claims, the morning in plain words. Facts gathered ${pt(f.generated_at)} PT, covering everything since ${pt(f.since)} PT. Every number here is measured.`, "");
  L.push("WHAT CHANGED ON THE SITE");
  if (f.first_run) L.push("- First email: nothing to compare with yet.");
  else if (!f.changes.lastUpdate) L.push("- The site was not updated.");
  else {
    L.push(`- The site was updated (latest ${pt(f.changes.lastUpdate)} PT).`);
    L.push(`- ${d.changes.published} more claims on the site, ${d.changes.flipped} verdicts changed, ${d.changes.settled} claims got a clear outcome, ${d.changes.calls} new "probably right" or "probably wrong" calls, ${d.changes.held} newly held back, ${d.changes.unheld} came off the held-back list.`);
    const moved = d.people.filter((p) => p.answerWas && p.answerWas !== p.answer);
    for (const p of moved) L.push(`- ${p.name}'s answer on the home page changed from "${p.answerWas}" to "${p.answer}".`);
    if (!moved.length) L.push("- Neither person's answer on the home page changed.");
    if (d.examples.length) { L.push("", "NEW VERDICTS (examples)"); for (const e of d.examples) L.push(`- ${e.person}, ${e.said}: "${e.quote}" is now ${e.now}${e.was ? ` (was ${e.was})` : ""}. ${e.url}`); }
  }
  L.push("", "SITE TRAFFIC");
  const t = d.traffic;
  if (!t.connected) L.push("- Not connected yet: Dave needs to make a read-only Cloudflare analytics token, so there are no traffic numbers.");
  else {
    if (t.people) { L.push(`- Real visitors (bots left out) since the last email: ${t.people.pageviews} page view${t.people.pageviews === 1 ? "" : "s"} in ${t.people.visits} visit${t.people.visits === 1 ? "" : "s"}.`); for (const x of t.people.pages) L.push(`  - ${x.path}: ${x.views}`); if (t.people.referrers.length) L.push(`- Where they came from: ${t.people.referrers.map((r) => `${r.host} ${r.views}`).join(", ")}.`); }
    if (t.days.length) L.push(`- Everything Cloudflare served, bots included, by day: ${t.days.map((x) => `${x.date} ${x.pageViews} page loads from ${x.uniques} unique visitors`).join("; ")}.`);
  }
  for (const n of t.notes) L.push(`- ${n}`);
  L.push("", "GRADING WORK SAVED SINCE THE LAST EMAIL (the daily update does the grading, and only work saved to the site's records shows here)");
  if (d.work.length) for (const w of d.work) L.push(`- ${w.count} ${w.label}`); else L.push("- None saved.");
  for (const w of d.workNote) L.push(`- ${w}`);
  if (d.lastSaved) L.push(`- Last work saved: ${pt(d.lastSaved)} PT.`);
  if (d.loop) L.push(`- ${d.loop}`);
  if (d.limits.length) { L.push("", "SUBSCRIPTIONS THAT RAN OUT"); for (const l of d.limits) L.push(`- ${l}`); }
  L.push("", "WAITING");
  for (const w of d.waiting) L.push(`- ${w.count != null ? `${w.count} ` : ""}${w.text}`);
  L.push("", `${d.postsHeading.toUpperCase()} (the register only covers posts up to its cutoff)`);
  for (const c of d.postCounts) L.push(`- ${c.person}: ${c.sinceCutoff} posts since ${c.cutoff}, not in the register yet.`);
  for (const p of d.posts) L.push(`- ${p.isNew ? "NEW · " : ""}${p.person}, ${p.date.slice(0, 10)}: "${p.title}" ${p.url}`);
  if (f.notes.length) { L.push("", "NOTES"); for (const n of f.notes) L.push(`- ${n}`); }
  return L.join("\n") + "\n";
}

// Commit the email files and the snapshot to the digest branch without
// touching the working tree or main: a temporary index, a tree, a commit on
// the branch's last commit, a push. "[CF-Pages-Skip]" stops Cloudflare
// building it.
function pushDigest(): void {
  const parent = fetchDigest();
  const index = path.join(os.tmpdir(), `pc-digest-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    if (parent) git(["read-tree", parent], env); else git(["read-tree", "--empty"], env);
    for (const name of ["latest.md", "latest.html", "latest.json", "snapshot.json"]) {
      const blob = git(["hash-object", "-w", path.join(OUT, name)]);
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},digest/${name}`], env);
    }
    const tree = git(["write-tree"], env);
    const commit = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", `Digest ${now.toISOString().slice(0, 10)} [CF-Pages-Skip]`], { GIT_AUTHOR_NAME: "Pundit Claims digest", GIT_AUTHOR_EMAIL: "davegoldblatt@gmail.com", GIT_COMMITTER_NAME: "Pundit Claims digest", GIT_COMMITTER_EMAIL: "davegoldblatt@gmail.com" });
    git(["push", "-q", "origin", `${commit}:refs/heads/digest`]);
    console.log(`pushed digest ${commit.slice(0, 9)} to the digest branch`);
  } finally { fs.rmSync(index, { force: true }); }
}

if (argv.includes("--push-only")) pushDigest();
else main().catch((err) => { console.error(err?.stack ?? err); process.exit(1); });
