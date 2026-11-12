// The morning email as designed HTML, built by code from measured facts
// (scripts/digest.ts). Same structure as the Because of AI digest: a heavy
// nameplate, a running line, poster-size numbers, ledger rows with a rule,
// in email-safe form (inline styles, the device's own interface font, one
// column, no images). The site's colours: indigo ink, and green, yellow and
// red for the three outcomes. Two placeholders stay for the routine to fill:
// <!--NOTE--> (the morning note) and <!--NEEDS--> (what needs Dave).

import { leftOutSentence, type LeftOut, type People } from "./traffic.ts";

export type Person = { id: string; name: string; published: number; held: number; answer: string; settled: number; supported: number; mixed: number; contradicted: number; pct: { supported: number; mixed: number; contradicted: number }; settledChange: number | null; answerWas: string | null };
export type Example = { person: string; quote: string; said: string; now: string; was: string | null; url: string };
export type Post = { person: string; title: string; date: string; url: string; isNew: boolean };
export type WaitLine = { text: string; count: number | null };
export type Traffic = { connected: boolean; people: null | People; left_out?: LeftOut | null; days: { date: string; pageViews: number; requests: number; uniques: number }[]; notes: string[] };
export type DigestForHtml = {
  generated_at: string;
  site: string;
  firstRun: boolean;
  people: Person[];
  totals: { published: number; held: number };
  changes: { published: number; held: number; unheld: number; flipped: number; settled: number; calls: number; updates: number };
  examples: Example[];
  work: { label: string; count: number }[];
  workNote: string[];
  lastSaved: string | null;
  loop: string;
  limits: string[];
  waiting: WaitLine[];
  posts: Post[];
  postCounts: { person: string; sinceCutoff: number; cutoff: string }[];
  postsHeading: string;
  traffic: Traffic;
};

const INK = "#1d2142", SOFT = "#565b74", RULE = "#e1e3ec", PAPER = "#ffffff", ACCENT = "#2b3bc0";
const OUT: Record<string, string> = { Supported: "#157a4b", Mixed: "#a07a12", Contradicted: "#b3261e", Unresolved: "#4f5fa3", "Probably right": "#157a4b", "Probably wrong": "#b3261e" };
// Mail apps drop downloaded fonts. The device's interface face is what the
// mail app itself is set in, and it is tuned for small sizes on screens.
const UI = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif";
const NUMS = "font-variant-numeric:tabular-nums;font-feature-settings:'tnum';";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (v: number) => v.toLocaleString("en-US");
const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
const label = (s: string, color = SOFT) => `<div style="font:600 12px/1.5 ${UI};text-transform:uppercase;letter-spacing:.06em;color:${color};">${esc(s)}</div>`;
const h2 = (s: string) => `<div style="font:700 13px/1.2 ${UI};text-transform:uppercase;letter-spacing:.08em;color:${INK};border-top:2px solid ${INK};padding-top:12px;margin:34px 0 12px;">${esc(s)}</div>`;
const row = (inner: string) => `<div style="border-top:1px solid ${RULE};padding:12px 0;">${inner}</div>`;
const meta = (s: string) => `<div style="font:400 13px/1.6 ${UI};${NUMS}color:${SOFT};margin-top:5px;">${s}</div>`;
const plain = (s: string) => `<div style="font:400 15px/1.5 ${UI};color:${SOFT};">${esc(s)}</div>`;
const tile = (n: string, l: string, color = INK) => `<td style="padding:0 22px 0 0;vertical-align:bottom;"><div style="font:800 40px/1 ${UI};${NUMS}letter-spacing:-.02em;color:${color};">${esc(n)}</div>${label(l)}</td>`;
const tiles = (inner: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 4px;"><tr>${inner}</tr></table>`;
const verdict = (s: string) => `<span style="color:${OUT[s] ?? INK};font-weight:600;">${esc(s)}</span>`;
const signed = (n: number) => (n > 0 ? `+${num(n)}` : n < 0 ? `&minus;${num(-n)}` : "no change");

export function renderHtml(d: DigestForHtml): string {
  const day = date(d.generated_at);
  const parts: string[] = [];

  parts.push(`<div style="font:800 26px/1.1 ${UI};letter-spacing:-.02em;color:${INK};">Pundit Claims</div>`);
  parts.push(`<div style="border-top:2px solid ${INK};border-bottom:1px solid ${RULE};margin:10px 0 22px;padding:9px 0;font:400 14px/1.5 ${UI};${NUMS}color:${SOFT};">${esc(day)} &middot; ${num(d.totals.published)} claims on the site &middot; ${num(d.totals.held)} held back</div>`);

  parts.push(`<div style="font:400 17px/1.55 ${UI};color:${INK};max-width:560px;"><!--NOTE--></div>`);

  // What changed on the site.
  parts.push(h2("On the site since yesterday"));
  if (d.firstRun) parts.push(plain("This is the first email, so there is nothing to compare with yet. Tomorrow's will show what changed."));
  else if (!d.changes.updates && !d.changes.published && !d.changes.held && !d.changes.flipped && !d.changes.calls) parts.push(plain("The site was not updated."));
  else {
    parts.push(tiles(`${tile(signed(d.changes.published), "newly on the site", ACCENT)}${tile(num(d.changes.flipped), "verdicts changed")}${tile(num(d.changes.calls), "new probably right or wrong")}${tile(num(d.changes.held), "newly held back")}`));
    parts.push(meta(`${d.changes.updates} site update${d.changes.updates === 1 ? "" : "s"}${d.changes.unheld ? ` &middot; ${num(d.changes.unheld)} came off the held-back list` : ""}`));
    for (const p of d.people.filter((x) => x.answerWas && x.answerWas !== x.answer)) parts.push(row(`<div style="font:600 16px/1.4 ${UI};color:${INK};">${esc(p.name)}'s answer changed: ${esc(p.answer)}</div>${meta(`Was ${esc(p.answerWas!)}`)}`));
    if (d.examples.length) {
      parts.push(`<div style="margin-top:16px;">${label("New verdicts")}</div>`);
      for (const e of d.examples) parts.push(row(`<a href="${esc(e.url)}" style="font:600 16px/1.4 ${UI};color:${INK};text-decoration:none;">&ldquo;${esc(e.quote)}&rdquo;</a>${meta(`${esc(e.person)} &middot; ${esc(date(e.said))} &middot; ${verdict(e.now)}${e.was ? ` (was ${esc(e.was)})` : ""}`)}`));
    }
  }

  // How the site is doing.
  parts.push(h2("Site traffic"));
  const t = d.traffic;
  if (!t.connected) parts.push(plain("Not connected yet. It needs a read-only Cloudflare analytics token."));
  else {
    if (t.people) {
      parts.push(tiles(`${tile(num(t.people.pageviews), t.people.pageviews === 1 ? "page view" : "page views", ACCENT)}${tile(num(t.people.visits), t.people.visits === 1 ? "visit" : "visits")}`));
      parts.push(meta(`Real visitors since yesterday, bots left out.${t.left_out ? ` ${esc(leftOutSentence(t.left_out))}` : ""}`));
      for (const x of t.people.pages) parts.push(row(`<div style="font:400 15px/1.4 ${UI};${NUMS}color:${INK};">${esc(x.path)} <span style="color:${SOFT};">${num(x.views)}</span></div>`));
      if (t.people.referrers.length) parts.push(meta(`Came from: ${t.people.referrers.map((r) => `${esc(r.host)} ${num(r.views)}`).join(" &middot; ")}`));
    }
    const y = t.days.at(-2) ?? t.days.at(-1);
    if (y) {
      if (!t.people) parts.push(tiles(`${tile(num(y.pageViews), "page loads", ACCENT)}${tile(num(y.uniques), "unique visitors")}`));
      parts.push(meta(`${t.people ? "Everything Cloudflare served" : `Everything Cloudflare served on ${esc(date(y.date))}`}, bots included. Page loads by day: ${t.days.map((x) => `${esc(date(x.date).replace(/, \d{4}$/, ""))} ${num(x.pageViews)}`).join(" &middot; ")}`));
    }
  }
  for (const n of t.notes) parts.push(meta(esc(n)));

  // Grading work saved since the last email (the daily update does the grading).
  parts.push(h2("Grading work saved"));
  if (d.work.length) parts.push(tiles(d.work.map((w, i) => tile(num(w.count), w.label, i === 0 ? ACCENT : INK)).join("")));
  else parts.push(plain("None saved since yesterday."));
  for (const w of d.workNote) parts.push(meta(esc(w)));
  if (d.lastSaved) parts.push(meta(`Last saved ${esc(new Date(d.lastSaved).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }))} PT`));
  if (d.loop) parts.push(meta(esc(d.loop)));
  if (d.limits.length) {
    parts.push(`<div style="margin-top:14px;">${label("Ran out")}</div>`);
    for (const l of d.limits) parts.push(row(`<div style="font:400 15px/1.5 ${UI};color:${INK};">${esc(l)}</div>`));
  }

  // What is queued.
  parts.push(h2("Waiting"));
  const shown = d.waiting.filter((w) => w.count !== 0);
  if (shown.length < d.waiting.length && !shown.some((w) => w.count != null)) parts.push(plain("No claims are waiting for a check, a rewrite, or a probably right or wrong call."));
  for (const w of shown) parts.push(row(`<div style="font:400 15px/1.5 ${UI};${NUMS}color:${INK};">${w.count != null ? `<span style="font-weight:700;">${num(w.count)}</span> ` : ""}${esc(w.text)}</div>`));

  // New writing the register has not read yet.
  parts.push(h2(d.postsHeading));
  parts.push(meta(d.postCounts.map((c) => `${esc(c.person)}: ${c.sinceCutoff} post${c.sinceCutoff === 1 ? "" : "s"} since ${esc(date(c.cutoff))}, not in the register yet`).join(" &middot; ")));
  const list = [...d.posts].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  for (const p of list) parts.push(row(`<a href="${esc(p.url)}" style="font:600 16px/1.4 ${UI};color:${INK};text-decoration:none;">${esc(p.title)}</a>${meta(`${esc(p.person)} &middot; ${esc(date(p.date))}${p.isNew ? ` &middot; <span style="color:${ACCENT};font-weight:600;">new since yesterday</span>` : ""}`)}`));
  if (!d.posts.some((p) => p.isNew)) parts.push(meta("Neither posted since yesterday."));

  parts.push(h2("Needs you"));
  parts.push(`<div style="font:400 17px/1.55 ${UI};color:${INK};"><!--NEEDS--></div>`);

  parts.push(`<div style="border-top:2px solid ${INK};margin-top:36px;padding-top:10px;font:400 13px/1.6 ${UI};color:${SOFT};">Every number here is measured by code. Facts gathered ${esc(new Date(d.generated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }))} PT &middot; <a href="${esc(d.site)}" style="color:${SOFT};">${esc(d.site.replace(/^https?:\/\//, ""))}</a> &middot; <a href="${esc(d.site)}/held" style="color:${SOFT};">held back</a></div>`);

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pundit Claims, ${esc(day)}</title></head><body style="margin:0;padding:0;background:${PAPER};"><div style="max-width:640px;margin:0 auto;padding:28px 20px 40px;background:${PAPER};color:${INK};">${parts.join("\n")}</div></body></html>\n`;
}
