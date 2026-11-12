// Real-visitor counts for the morning email, with automated sweeps left out.
//
// Cloudflare's counter marks most bots, but not all of them. On 2026-11-11 a
// program loaded about 1,540 claim pages in half an hour (22:00 to 22:15 UTC
// held 1,506 loads in 1,505 visits over 1,471 different pages, all with no
// link in) and Cloudflare counted every load as a real visit. Real readers
// that day made about 47 visits.
//
// The counts come in 15-minute windows. A window is a sweep when it has at
// least SWEEP_MIN_LOADS page loads and, for at least SWEEP_SHARE of them,
// each load is a different page, each load is a new visit, and nobody linked
// in. People do not look like that: a crowd from one link lands on a few
// pages, and a person browsing makes several loads in one visit with the site
// itself as the link in.

export const SWEEP_MIN_LOADS = 25;
export const SWEEP_SHARE = 0.8;
const WINDOW_MS = 15 * 60_000;

export type WindowRow = { window: string; loads: number; visits: number };
export type PathRow = { window: string; path: string; loads: number };
export type RefRow = { window: string; host: string; loads: number };
export type People = { pageviews: number; visits: number; pages: { path: string; views: number }[]; referrers: { host: string; views: number }[] };
export type LeftOut = { loads: number; visits: number; spans: { start: string; end: string; loads: number }[] };

export function splitSweeps(windows: WindowRow[], paths: PathRow[], refs: RefRow[], ownHosts: string[]): { people: People | null; left_out: LeftOut | null } {
  const distinct = new Map<string, number>(), unlinked = new Map<string, number>();
  for (const p of paths) distinct.set(p.window, (distinct.get(p.window) ?? 0) + 1);
  for (const r of refs) if (!r.host) unlinked.set(r.window, (unlinked.get(r.window) ?? 0) + r.loads);
  const isSweep = (w: WindowRow) =>
    w.loads >= SWEEP_MIN_LOADS &&
    (distinct.get(w.window) ?? 0) >= SWEEP_SHARE * w.loads &&
    w.visits >= SWEEP_SHARE * w.loads &&
    (unlinked.get(w.window) ?? 0) >= SWEEP_SHARE * w.loads;
  const sweeps = new Set(windows.filter(isSweep).map((w) => w.window));

  let pageviews = 0, visits = 0;
  for (const w of windows) if (!sweeps.has(w.window)) { pageviews += w.loads; visits += w.visits; }
  const sum = <T,>(rows: T[], key: (r: T) => string, loads: (r: T) => number, keep: (r: T) => boolean) => {
    const m = new Map<string, number>();
    for (const r of rows) if (keep(r)) m.set(key(r), (m.get(key(r)) ?? 0) + loads(r));
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const pages = sum(paths, (p) => p.path, (p) => p.loads, (p) => !sweeps.has(p.window)).slice(0, 8).map(([path, views]) => ({ path, views }));
  const referrers = sum(refs, (r) => r.host, (r) => r.loads, (r) => !sweeps.has(r.window) && !!r.host && !ownHosts.includes(r.host)).slice(0, 6).map(([host, views]) => ({ host, views }));

  let left_out: LeftOut | null = null;
  if (sweeps.size) {
    const swept = windows.filter((w) => sweeps.has(w.window)).sort((a, b) => a.window.localeCompare(b.window));
    const spans: LeftOut["spans"] = [];
    for (const w of swept) {
      const start = Date.parse(w.window), last = spans.at(-1);
      if (last && Date.parse(last.end) === start) { last.end = new Date(start + WINDOW_MS).toISOString(); last.loads += w.loads; }
      else spans.push({ start: new Date(start).toISOString(), end: new Date(start + WINDOW_MS).toISOString(), loads: w.loads });
    }
    left_out = { loads: swept.reduce((n, w) => n + w.loads, 0), visits: swept.reduce((n, w) => n + w.visits, 0), spans };
  }
  const any = windows.some((w) => w.loads > 0);
  return { people: any ? { pageviews, visits, pages, referrers } : null, left_out };
}

// One plain sentence for both the facts and the designed email.
export function leftOutSentence(l: LeftOut): string {
  const day = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const time = (iso: string) => new Date(iso).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const when = l.spans.map((s) => `${day(s.start)} to ${time(s.end)} PT`).join("; ");
  return `Left out ${l.loads.toLocaleString("en-US")} more page loads that look like a program reading the site, not people: each was a different page, each a new visit, with nobody linking in (${when}).`;
}
