// Lists that stay usable at any size. A register page shows one group of
// claims (the claims checked against evidence first, the claims that cannot
// be checked apart) and splits a long group into numbered pages. A post page
// lists every claim recorded from one source post. Pure functions of release
// data; scripts/check-dist.ts recomputes all of it on its own.
import type { HeldRecord, PublicClaim, PublicEvent } from "./manifest.ts";
import { HORIZON_LABEL, OUTCOME_DESCRIPTION, OUTCOME_LABEL } from "../policy.ts";
import { hashOf } from "./canonical.ts";
import { byNewest, bySaid, personPath, shownAssessment } from "./view.ts";

// Rows on one register page. Each row is about 1.5 KB of HTML.
export const PAGE_SIZE = 100;

// The groups a register can show. "checked" is every claim graded on
// evidence; the next five split it; "uncheckable" is everything else.
export const GROUPS = ["checked", "supported", "contradicted", "mixed", "unresolved", "not-yet-due", "uncheckable"] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABEL: Record<Group, string> = {
  checked: "All checked claims",
  supported: OUTCOME_LABEL.supported,
  contradicted: OUTCOME_LABEL.contradicted,
  mixed: OUTCOME_LABEL.mixed,
  unresolved: OUTCOME_LABEL.unresolved,
  "not-yet-due": HORIZON_LABEL.not_due,
  uncheckable: OUTCOME_LABEL.not_adjudicable,
};

export const GROUP_TITLE: Record<Group, string> = {
  checked: "Checked claims",
  supported: "Supported claims",
  contradicted: "Contradicted claims",
  mixed: "Mixed claims",
  unresolved: "Unresolved claims",
  "not-yet-due": "Claims not yet due",
  uncheckable: "Claims that can’t be checked",
};

export const GROUP_NOTE: Record<Group, string> = {
  checked: "Claims we checked against evidence.",
  supported: OUTCOME_DESCRIPTION.supported,
  contradicted: OUTCOME_DESCRIPTION.contradicted,
  mixed: OUTCOME_DESCRIPTION.mixed,
  unresolved: `${OUTCOME_DESCRIPTION.unresolved} Predictions whose deadline hasn’t come yet are under Not yet due.`,
  "not-yet-due": "Predictions whose deadline hasn’t passed yet. A deadline that hasn’t arrived isn’t a miss.",
  uncheckable: "Opinions, rhetoric, hedged or vague claims, and things no public evidence could show. Listed, not scored.",
};

export function inGroup(c: PublicClaim, g: Group): boolean {
  const o = c.current!.payload.outcome;
  switch (g) {
    case "checked": return o !== "not_adjudicable";
    case "uncheckable": return o === "not_adjudicable";
    case "unresolved": return o === "unresolved" && c.review.horizon_now !== "not_due";
    case "not-yet-due": return o === "unresolved" && c.review.horizon_now === "not_due";
    default: return o === g;
  }
}

// The address of one page of a group. Page 1 of the checked claims is the
// home page (all people) or the person's page.
export function listPath(scope: string | null, g: Group, page = 1): string {
  const head = scope ? `${personPath(scope)}/${g}` : `/register/${g}`;
  return page === 1 ? head : `${head}/${page}`;
}

export const pageCount = (n: number): number => Math.max(1, Math.ceil(n / PAGE_SIZE));

export type Listing = { scope: string | null; group: Group; page: number; pages: number; total: number; rows: PublicClaim[]; counts: Record<Group, number> };

// Every page of every group for one scope (all people, or one person), live claims only.
export function listings(live: PublicClaim[], scope: string | null): Listing[] {
  const mine = [...(scope ? live.filter((c) => c.subject_id === scope) : live)].sort(bySaid);
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, mine.filter((c) => inGroup(c, g))])) as Record<Group, PublicClaim[]>;
  const counts = Object.fromEntries(GROUPS.map((g) => [g, byGroup[g].length])) as Record<Group, number>;
  const out: Listing[] = [];
  for (const g of GROUPS) {
    const rows = byGroup[g];
    // An empty group has no page, except the checked claims, whose first page is the landing page.
    if (!rows.length && g !== "checked") continue;
    const pages = pageCount(rows.length);
    for (let p = 1; p <= pages; p++) out.push({ scope, group: g, page: p, pages, total: rows.length, rows: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), counts });
  }
  return out;
}

const cache = new WeakMap<PublicClaim[], Map<string, Listing[]>>();
// The listings for a scope, computed once per release.
export function listingsFor(live: PublicClaim[], scope: string | null): Listing[] {
  let m = cache.get(live);
  if (!m) cache.set(live, (m = new Map()));
  const k = scope ?? "";
  if (!m.has(k)) m.set(k, listings(live, scope));
  return m.get(k)!;
}

// --- changes ------------------------------------------------------------------------------

// Substantive changes, newest first, split the same way. Page 1 is /changes.
export const CHANGES_PAGE_SIZE = 200;
// The RSS feed carries the newest changes only; /changes lists every one.
export const FEED_ITEMS = 200;
export const changesPath = (page = 1): string => (page === 1 ? "/changes" : `/changes/${page}`);

const eventPageCache = new WeakMap<PublicEvent[], Map<string, number>>();
// The page of /changes that lists an event, or null for a copy edit.
export function changesPageOf(events: PublicEvent[], id: string): number | null {
  let m = eventPageCache.get(events);
  if (!m) {
    const subst = events.filter((e) => e.substantive).sort(byNewest);
    eventPageCache.set(events, (m = new Map(subst.map((e, i) => [e.event_id, Math.floor(i / CHANGES_PAGE_SIZE) + 1]))));
  }
  return m.get(id) ?? null;
}

// --- source posts ----------------------------------------------------------------------

export type PostItem = { claim: PublicClaim; excerpt: string; locator: string };
export type Post = { key: string; path: string; url: string; title: string; publisher: string | null; date: string | null; subject_id: string; items: PostItem[]; held: HeldRecord[] };

// Two addresses for the same post (a trailing slash, a query string, a
// fragment, upper-case host) are one post.
export function postKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch { return url; }
}

// /posts/<host>/<path>, mirroring the source address in safe characters.
function postPathParts(key: string): string[] {
  let u: URL;
  try { u = new URL(key); } catch { return ["post", hashOf(key).slice(0, 12)]; }
  const clean = (s: string) => { let d = s; try { d = decodeURIComponent(s); } catch { /* keep as is */ } return d.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); };
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]+/g, "-");
  // "index" would build as a directory index and lose its address.
  const segs = u.pathname.split("/").map(clean).filter(Boolean).map((s) => (s === "index" ? "index-page" : s));
  return [host, ...(segs.length ? segs : ["home"])];
}

const paragraph = (locator: string): number => { const m = /paragraph (\d+)/i.exec(locator); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER; };

// Every source post that a published claim was recorded from: the post its
// assessment quotes, and any other post where it was said again. Held records
// from the same post are attached. Posts are ordered newest first.
export function posts(claims: PublicClaim[], held: HeldRecord[]): Post[] {
  const by = new Map<string, Post>();
  const at = (url: string, init: () => Omit<Post, "key" | "path" | "items" | "held">): Post => {
    const key = postKey(url);
    let p = by.get(key);
    if (!p) by.set(key, (p = { key, path: "", ...init(), items: [], held: [] }));
    return p;
  };
  for (const c of claims) {
    const a = shownAssessment(c);
    const seen = new Set<string>();
    for (const o of c.occurrences) {
      const p = at(o.document.url, () => ({ url: o.document.url, title: o.document.title, publisher: o.document.publisher, date: o.document.published_at ? o.document.published_at.slice(0, 10) : o.statement_date, subject_id: c.subject_id }));
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      p.items.push({ claim: c, excerpt: o.excerpt, locator: o.locator });
    }
    if (a) {
      const s = a.payload.statement;
      const p = at(s.url, () => ({ url: s.url, title: s.document_title, publisher: null, date: s.date, subject_id: c.subject_id }));
      if (!seen.has(p.key)) p.items.push({ claim: c, excerpt: s.excerpt, locator: s.locator });
    }
  }
  for (const h of held) by.get(postKey(h.source.url))?.held.push(h);
  const list = [...by.values()];
  // Addresses: mirror the source; two posts that would share one get a short hash each.
  const parts = new Map(list.map((p) => [p.key, postPathParts(p.key)]));
  const uses = new Map<string, number>();
  for (const v of parts.values()) uses.set(v.join("/"), (uses.get(v.join("/")) ?? 0) + 1);
  for (const p of list) {
    const v = [...parts.get(p.key)!];
    if (uses.get(v.join("/"))! > 1) v[v.length - 1] = `${v.at(-1)}-${hashOf(p.key).slice(0, 6)}`;
    p.path = `/posts/${v.join("/")}`;
    p.items.sort((x, y) => paragraph(x.locator) - paragraph(y.locator) || x.claim.claim_id.localeCompare(y.claim.claim_id));
  }
  return list.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? "") || x.path.localeCompare(y.path));
}

const postCache = new WeakMap<PublicClaim[], { list: Post[]; byKey: Map<string, Post> }>();
function postIndex(claims: PublicClaim[], held: HeldRecord[]) {
  let v = postCache.get(claims);
  if (!v) {
    const list = posts(claims, held);
    postCache.set(claims, (v = { list, byKey: new Map(list.map((p) => [p.key, p])) }));
  }
  return v;
}
export const postsFor = (claims: PublicClaim[], held: HeldRecord[]): Post[] => postIndex(claims, held).list;
// The post a claim's shown assessment quotes.
export function postOf(claims: PublicClaim[], held: HeldRecord[], c: PublicClaim): Post | null {
  const url = shownAssessment(c)?.payload.statement.url ?? c.occurrences[0]?.document.url;
  return url ? postIndex(claims, held).byKey.get(postKey(url)) ?? null : null;
}
