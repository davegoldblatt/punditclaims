// The Explore page. Loads /api/explore.json once, then filters in the browser.
// Filters live in the query string, so a cut can be shared and survives reload.
// Each facet's option counts are computed with every other filter applied. The
// answer for the cut uses the same rule as the home page (src/lib/answer.ts),
// and is hidden while an outcome filter is on, because filtering by outcome
// would decide the answer.
import { answerFor, MIN_SETTLED } from "../lib/answer.ts";
import { shardOf } from "../lib/shard.ts";

type Claim = { id: string; person: string; company: string[]; topic: string[]; kind: string; outcome: string; said: string; year: string; reading: string; words: string; source: string; path: string; checked?: string; why?: { label: string; text: string; publisher: string; url: string; date: string }[]; probable?: { call: "probably_right" | "probably_wrong"; level: "reasonable" | "speculative"; reasons?: { provider: "anthropic" | "openai"; reason: string }[] }; held?: boolean };
type Index = { labels: Record<"person" | "company" | "topic" | "kind" | "outcome", Record<string, string>>; claims: Claim[]; held?: Claim[] };
type Key = "person" | "company" | "topic" | "kind" | "outcome" | "year";
const KEYS: Key[] = ["person", "company", "topic", "kind", "outcome", "year"];
const PAGE = 50;
const KIND_GROUPS: Record<string, string[]> = { prediction: ["forecast", "conditional_forecast"], observation: ["observation"], causal: ["causal"], normative: ["normative"], rhetoric: ["rhetoric"] };
const KIND_NAMES: Record<string, string> = { prediction: "Prediction", observation: "Observation", causal: "Causal claim", normative: "Recommendation or value judgment", rhetoric: "Rhetoric" };
const fmt = (n: number) => n.toLocaleString("en-US");
const OUTCOMES = ["supported", "mixed", "contradicted", "unresolved", "not_adjudicable"] as const;
const SVG = "http://www.w3.org/2000/svg";
type Split = Record<(typeof OUTCOMES)[number], number>;
const emptySplit = (): Split => ({ supported: 0, mixed: 0, contradicted: 0, unresolved: 0, not_adjudicable: 0 });

// One stacked bar. Its length is total/max of the chart, so rows compare by
// number of claims; the segments are the outcomes in a fixed order. Widths are
// SVG attributes: the site's CSP blocks inline styles.
function stacked(split: Split, max: number, title: string): SVGSVGElement {
  const W = 1000, GAP = 3;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} 20`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "bar-svg");
  svg.setAttribute("aria-hidden", "true");
  const total = OUTCOMES.reduce((a, k) => a + split[k], 0);
  const length = max ? (W * total) / max : 0;
  const parts = OUTCOMES.filter((k) => split[k] > 0);
  const room = Math.max(0, length - GAP * (parts.length - 1));
  let x = 0;
  for (const k of parts) {
    const w = Math.max(2, (room * split[k]) / total);
    const r = document.createElementNS(SVG, "rect");
    r.setAttribute("class", `seg-${k}`);
    r.setAttribute("x", x.toFixed(1)); r.setAttribute("y", "0"); r.setAttribute("width", w.toFixed(1)); r.setAttribute("height", "20");
    const t = document.createElementNS(SVG, "title"); t.textContent = title; r.append(t);
    svg.append(r);
    x += w + GAP;
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}

type Detail = { assessment: string; as_of: string | null; rationale: string; limitations: string[]; evidence: { relation: string; publisher: string; url: string; event_date: string | null; available_at: string | null; excerpt: string; explanation: string }[]; citation: string; quote: string };
const shards = new Map<number, Promise<Record<string, Detail>>>();
function detailOf(id: string): Promise<Detail | undefined> {
  const n = shardOf(id);
  if (!shards.has(n)) shards.set(n, fetch(`/api/evidence/${n}.json`).then((r) => r.json()).catch(() => { shards.delete(n); return {}; }));
  return shards.get(n)!.then((x) => x[id]);
}
async function copyText(text: string, status: HTMLElement): Promise<void> {
  try { await navigator.clipboard.writeText(text); status.textContent = "Copied."; }
  catch { status.textContent = "Copy failed. Open the record to copy it."; }
}
const RELATION: Record<string, string> = { supports: "Supports", contradicts: "Goes against", context: "Context", qualifies: "Qualifies" };

export async function runExplore(root: HTMLElement): Promise<void> {
  const form = root.querySelector<HTMLFormElement>("[data-explore-form]")!;
  const rows = root.querySelector<HTMLOListElement>("[data-rows]")!;
  const more = root.querySelector<HTMLButtonElement>("[data-more]")!;
  const count = root.querySelector<HTMLElement>("[data-result]")!;
  const answer = root.querySelector<HTMLElement>("[data-answer]")!;
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const charts = root.querySelector<HTMLElement>("[data-charts]")!;
  // Outcomes are chosen with the color key above the charts, not a select.
  // On a person's page the tool is locked to that person: no person select,
  // and the person never goes in the address.
  const locked = root.dataset.person || null;
  const SELECT_KEYS = KEYS.filter((k) => k !== "outcome" && !(locked && k === "person"));
  const selects = Object.fromEntries(SELECT_KEYS.map((k) => [k, form.querySelector<HTMLSelectElement>(`select[name=${k}]`)!])) as Record<Key, HTMLSelectElement>;
  const q = form.querySelector<HTMLInputElement>("input[name=q]")!;
  const sorts = [...form.querySelectorAll<HTMLInputElement>("input[name=xsort]")];
  // "What kind": a shortcut onto the kind filter (docs/plans/predictions-vs-claims.md).
  // Predictions are forecasts and conditional forecasts; present and past are
  // observations and causal claims. Any other kind combination selects none.
  // The page's kind switch (KindSwitch.astro), above the tool.
  const kindRadios = [...document.querySelectorAll<HTMLInputElement>("input[name=kindsw]")];
  const KIND_SHORTCUT: Record<string, string[]> = { all: [], prediction: ["prediction"], present: ["observation", "causal"] };
  const showKind = () => {
    const now = [...state.kind].sort().join(",");
    for (const r of kindRadios) r.checked = [...KIND_SHORTCUT[r.value]].sort().join(",") === now;
  };
  const SORTS = ["newest", "oldest", "checked"];
  const copyLink = root.querySelector<HTMLButtonElement>("[data-copy-link]")!;
  const copyLinkStatus = root.querySelector<HTMLElement>("[data-copy-link-status]")!;

  let index: Index;
  try {
    const res = await fetch("/api/explore.json");
    index = await res.json();
  } catch {
    status.textContent = "The claims could not be loaded. Reload the page, or browse the register instead.";
    return;
  }
  status.textContent = "";
  form.hidden = false;
  // Published claims and held records with a probable call, newest first by date said.
  const pool: Claim[] = [...index.claims, ...(index.held ?? [])].sort((a, b) => b.said.localeCompare(a.said) || a.id.localeCompare(b.id));
  const L = index.labels;
  const label = (k: Key, v: string): string =>
    k === "kind" ? KIND_NAMES[v] ?? v : k === "year" ? v : k === "company" && v === "none" ? "No company named" : (L as any)[k]?.[v] ?? v;
  // How sure (docs/adr/0006): the page's "How sure?" switch. Strict counts the
  // settled claims only. Reasonable also counts the calls both AIs made, and
  // speculative the calls one AI made, as probably right (supported) or
  // probably wrong (contradicted). Held claims appear only through such a call.
  const LEVELS = ["strict", "reasonable", "speculative"];
  let level = "strict";
  const counted = (c: Claim): boolean => !!c.probable && level !== "strict" && LEVELS.indexOf(c.probable.level) <= LEVELS.indexOf(level);
  const eff = (c: Claim): string | null => (counted(c) ? (c.probable!.call === "probably_right" ? "supported" : "contradicted") : c.held ? null : c.outcome);
  const valuesOf = (c: Claim, k: Key): string[] =>
    k === "company" ? (c.company.length ? c.company : ["none"]) : k === "topic" ? c.topic
      : k === "kind" ? Object.keys(KIND_GROUPS).filter((g) => KIND_GROUPS[g].includes(c.kind)) : k === "outcome" ? [eff(c) ?? "held"] : [String(c[k])];

  // State from the address. A value may list several options, comma-separated.
  // state.outcome is the outcomes shown. On first load only the settled ones:
  // readers come for right, wrong, or mixed (Dave 2026-10-30). The color key
  // turns each outcome on and off.
  const SETTLED_ONLY = ["supported", "mixed", "contradicted"];
  const isDefault = (xs: string[]) => xs.length === SETTLED_ONLY.length && SETTLED_ONLY.every((o) => xs.includes(o));
  const state: Record<Key, string[]> & { q: string; sort: string } = { person: [], company: [], topic: [], kind: [], outcome: [...SETTLED_ONLY], year: [], q: "", sort: "newest" };
  function readUrl(): void {
    const u = new URL(location.href);
    for (const k of KEYS) state[k] = (u.searchParams.get(k) ?? "").split(",").filter(Boolean);
    state.q = u.searchParams.get("q") ?? "";
    const s = u.searchParams.get("sort") ?? "";
    state.sort = SORTS.includes(s) ? s : "newest";
    // The old "show everything" switches still work as links.
    if (locked) state.person = [locked];
    if (!state.outcome.length) state.outcome = u.searchParams.get("all") === "1" || u.searchParams.get("uncheckable") === "1" ? [...OUTCOMES] : [...SETTLED_ONLY];
  }
  function writeUrl(): void {
    const u = new URL(location.href);
    for (const k of KEYS) state[k].length && !(k === "outcome" && isDefault(state[k])) ? u.searchParams.set(k, state[k].join(",")) : u.searchParams.delete(k);
    state.q ? u.searchParams.set("q", state.q) : u.searchParams.delete("q");
    state.sort !== "newest" ? u.searchParams.set("sort", state.sort) : u.searchParams.delete("sort");
    u.searchParams.delete("uncheckable");
    u.searchParams.delete("all");
    if (locked) u.searchParams.delete("person");
    level !== "strict" ? u.searchParams.set("sure", level) : u.searchParams.delete("sure");
    history.replaceState(null, "", u.pathname + (u.search ? u.search : ""));
  }

  const words = (s: string) => s.toLowerCase();
  const matchQ = (c: Claim): boolean => !state.q || words(`${c.reading} ${c.words} ${c.source}`).includes(words(state.q.trim()));
  const pass = (c: Claim, skip?: Key): boolean =>
    eff(c) !== null && matchQ(c) && KEYS.every((k) => k === skip || !state[k].length || valuesOf(c, k).some((v) => state[k].includes(v)));

  let shown = 0;
  let current: Claim[] = [];

  function renderOptions(): void {
    for (const k of SELECT_KEYS) {
      const counts = new Map<string, number>();
      for (const c of pool) if (pass(c, k)) for (const v of valuesOf(c, k)) counts.set(v, (counts.get(v) ?? 0) + 1);
      const all = new Set<string>([...counts.keys(), ...state[k]]);
      let order = [...all];
      if (k === "year") order.sort((a, b) => b.localeCompare(a));
      else if (k === "kind") order = Object.keys(KIND_GROUPS).filter((v) => all.has(v));
      else order.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || label(k, a).localeCompare(label(k, b)));
      if (k === "company") order = [...order.filter((v) => v !== "none"), ...order.filter((v) => v === "none")];
      const sel = selects[k];
      sel.replaceChildren(el("option", { value: "" }, sel.dataset.any ?? "Any"));
      if (state[k].length > 1) sel.append(el("option", { value: state[k].join(",") }, `${state[k].map((v) => label(k, v)).join(" or ")}`));
      for (const v of order) sel.append(el("option", { value: v }, `${label(k, v)} (${fmt(counts.get(v) ?? 0)})`));
      sel.value = state[k].join(",");
    }
  }

  function row(c: Claim): HTMLLIElement {
    const probableHere = counted(c);
    const verdict = probableHere
      ? el("span", { class: "label label-probable", "data-o": eff(c)! }, c.probable!.call === "probably_right" ? "Probably right" : "Probably wrong")
      : el("span", { class: "label", "data-o": c.outcome }, L.outcome[c.outcome] ?? c.outcome);
    const margin = el("p", { class: "row-margin" }, verdict, el("span", { class: "row-date" }, el("span", { class: "k" }, "Said "), el("time", { datetime: c.said }, c.said)));
    // Their words and the grade; our reading and the source are on the claim page.
    const by = el("p", { class: "row-by" }, el("a", { href: `/people/${c.person}` }, L.person[c.person] ?? c.person));
    const quote = c.held && !c.words
      ? el("h3", { class: "row-q row-q-held" }, el("a", { href: c.path }, c.reading), el("span", { class: "k" }, " (held back until it passes every check)"))
      : el("h3", { class: c.held ? "row-q row-q-held" : "row-q" }, el("a", { href: c.path }, el("span", {}, `“${c.words}”`)), ...(c.held ? [el("span", { class: "k" }, " (held back until it passes every check)")] : []));
    // What settled it, as on the register rows. A probable call shows each
    // agreeing AI's own one-line reason instead.
    const COMPANY: Record<string, string> = { anthropic: "Anthropic’s AI", openai: "OpenAI’s AI" };
    const why = probableHere
      ? (c.probable!.reasons ?? []).map((r) => el("p", { class: "row-line row-why" }, el("span", { class: "k" }, `Why ${c.probable!.call === "probably_right" ? "probably right" : "probably wrong"}, per ${COMPANY[r.provider] ?? r.provider}: `), r.reason))
      : (c.why ?? []).map((w) => el("p", { class: "row-line row-why" }, el("span", { class: "k" }, `${w.label}: `), `${w.text} `, el("span", { class: "row-why-src" }, "(", el("a", { href: w.url, rel: "noopener" }, w.publisher), `, ${w.date})`)));
    // The receipt, on demand: our rationale, each evidence item, and a quote
    // with its citation to paste into a post.
    const panel = el("div", { class: "receipt", hidden: "" });
    const status = el("span", { class: "copy-status", "aria-live": "polite" });
    const show = el("button", { type: "button", class: "linkish", "aria-expanded": "false" }, "Show the evidence");
    const copy = el("button", { type: "button", class: "linkish" }, "Copy quote and citation");
    show.addEventListener("click", async () => {
      const open = show.getAttribute("aria-expanded") === "true";
      show.setAttribute("aria-expanded", open ? "false" : "true");
      show.textContent = open ? "Show the evidence" : "Hide the evidence";
      if (open) { panel.hidden = true; return; }
      panel.hidden = false;
      if (panel.childElementCount) return;
      panel.append(el("p", { class: "small soft" }, "Loading…"));
      const d = await detailOf(c.id);
      panel.replaceChildren();
      if (!d) { panel.append(el("p", { class: "small" }, "The evidence could not be loaded. ", el("a", { href: c.path }, "Open the full record"), ".")); return; }
      if (d.rationale) panel.append(el("p", {}, d.rationale));
      if (d.evidence.length) {
        const list = el("ul", { class: "receipt-items" });
        for (const e of d.evidence) {
          const when = [e.event_date && `event ${e.event_date}`, e.available_at && `published ${e.available_at}`].filter(Boolean).join(", ");
          list.append(el("li", {}, el("b", {}, `${RELATION[e.relation] ?? e.relation}: `), el("a", { href: e.url, rel: "noopener" }, e.publisher || e.url), when ? ` (${when})` : "", e.explanation ? `. ${e.explanation}` : ""));
        }
        panel.append(list);
      }
      if (d.limitations.length) panel.append(el("p", { class: "small" }, el("span", { class: "k" }, "Caveats: "), d.limitations.join(" ")));
      panel.append(el("p", { class: "small" }, d.as_of ? `Evidence up to ${d.as_of}. ` : "", el("a", { href: c.path }, "Open the full record")));
    });
    copy.addEventListener("click", async () => {
      const d = await detailOf(c.id);
      await copyText(d ? `${d.quote}\n${d.citation}` : `“${c.words}” ${location.origin}${c.path}`, status);
    });
    const actions = c.held ? el("p", { class: "row-actions" }) : el("p", { class: "row-actions" }, show, copy, status);
    return el("li", { class: "row" }, margin, el("div", { class: "row-body" }, ...(locked ? [] : [by]), quote, ...why, actions, panel));
  }

  function renderAnswer(): void {
    answer.replaceChildren();
    if (!SETTLED_ONLY.every((o) => state.outcome.includes(o))) {
      answer.append(el("p", { class: "small soft" }, "Turn supported, mixed, and contradicted back on to see the answer for this cut."));
      return;
    }
    for (const id of Object.keys(L.person)) {
      const mine = current.filter((c) => c.person === id);
      if (!mine.length) continue;
      const s = { supported: 0, mixed: 0, contradicted: 0 };
      for (const c of mine) { const o = eff(c); if (o && o in s) s[o as keyof typeof s]++; }
      const n = s.supported + s.mixed + s.contradicted;
      const words = answerFor(s);
      // Above strict, the level is named beside the answer.
      const levelName = level === "reasonable" ? "At reasonable confidence" : level === "speculative" ? "Speculative" : "";
      const prob = mine.filter(counted).length;
      const what = prob ? `claims, including ${fmt(prob)} probable calls` : "claims with a clear outcome";
      const detail = n >= MIN_SETTLED
        ? ` ${Math.round((100 * s.supported) / n)}% right across ${fmt(n)} ${what}. ${fmt(s.mixed)} mixed, ${fmt(s.contradicted)} wrong.`
        : ` ${fmt(n)} with a clear outcome so far: ${fmt(s.supported)} supported, ${fmt(s.mixed)} mixed, ${fmt(s.contradicted)} contradicted.`;
      // Click a person's answer to narrow the cut to them; click again to undo.
      const only = state.person.length === 1 && state.person[0] === id;
      const head = levelName ? `${L.person[id]}, ${levelName.toLowerCase()}: ${words}` : `${L.person[id]}: ${words}`;
      const tail = detail;
      const pick = locked ? el("span", {}, el("b", {}, head), tail) : el("button", { type: "button", class: "explore-answer-pick", "aria-pressed": only ? "true" : "false", title: only ? "Show both people again" : `Show only ${L.person[id]}` }, el("b", {}, head), tail);
      if (!locked) pick.addEventListener("click", () => { state.person = only ? [] : [id]; writeUrl(); update(); });
      const line = el("div", { class: "explore-answer" }, el("p", {}, pick));
      if (n > 0) {
        const sp = emptySplit(); sp.supported = s.supported; sp.mixed = s.mixed; sp.contradicted = s.contradicted;
        const bar = stacked(sp, n, `${L.person[id]}: ${s.supported} supported, ${s.mixed} mixed, ${s.contradicted} contradicted`);
        bar.setAttribute("class", "split");
        line.append(bar);
      }
      answer.append(line);
    }
  }

  const describe = (name: string, x: Split, total: number) =>
    `${name}: ${fmt(total)} claims. ${OUTCOMES.filter((k) => x[k]).map((k) => `${fmt(x[k])} ${(L.outcome[k] ?? k).toLowerCase()}`).join(", ")}.`;

  // Two charts over the current cut: when the claims were said, and which
  // companies they are about. A row is a button that applies its filter.
  function chart(title: string, key: Key, groups: [string, string, Split][], note?: string): HTMLElement {
    const max = Math.max(1, ...groups.map(([, , x]) => OUTCOMES.reduce((a, k) => a + x[k], 0)));
    const list = el("ul", { class: "chart-rows" });
    for (const [value, name, x] of groups) {
      const total = OUTCOMES.reduce((a, k) => a + x[k], 0);
      const on = state[key].length === 1 && state[key][0] === value;
      const b = el("button", { type: "button", "aria-pressed": on ? "true" : "false", "aria-label": `${describe(name, x, total)} ${on ? "Remove this filter." : "Filter to this."}` },
        el("span", {}, name), stacked(x, max, describe(name, x, total)), el("span", { class: "n" }, fmt(total)));
      b.addEventListener("click", () => { state[key] = on ? [] : [value]; writeUrl(); update(); });
      list.append(el("li", {}, b));
    }
    const box = el("section", { class: "chart" }, el("h3", {}, title), list);
    if (note) box.append(el("p", { class: "chart-note" }, note));
    return box;
  }

  function renderCharts(): void {
    charts.replaceChildren();
    // The color key is also the outcome switch: click a color to show or hide
    // it. It is drawn even when nothing matches, so hidden outcomes can come back.
    const key = el("ul", { class: "chart-key chart-key-toggles", "aria-label": "Outcomes shown. Click to show or hide." }, ...OUTCOMES.map((k) => {
      const on = state.outcome.includes(k);
      const b = el("button", { type: "button", "data-o": k, "aria-pressed": on ? "true" : "false" }, el("i", { "aria-hidden": "true" }), L.outcome[k] ?? k);
      b.addEventListener("click", () => { const next = on ? state.outcome.filter((o) => o !== k) : [...state.outcome, k]; if (!next.length) return; state.outcome = next; writeUrl(); update(); });
      return el("li", {}, b);
    }));
    charts.append(key);
    if (!current.length) return;
    const byYear = new Map<string, Split>(), byCo = new Map<string, Split>();
    for (const c of current) {
      const o = (eff(c) ?? c.outcome) as keyof Split;
      (byYear.get(c.year) ?? byYear.set(c.year, emptySplit()).get(c.year)!)[o]++;
      for (const co of c.company) (byCo.get(co) ?? byCo.set(co, emptySplit()).get(co)!)[o]++;
    }
    const sum = (x: Split) => OUTCOMES.reduce((a, k) => a + x[k], 0);
    const years = [...byYear].sort((a, b) => a[0].localeCompare(b[0])).map(([y, x]) => [y, y, x] as [string, string, Split]);
    const cos = [...byCo].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 10).map(([id, x]) => [id, L.company[id] ?? id, x] as [string, string, Split]);
    const unnamed = current.filter((c) => !c.company.length).length;
    const grid = el("div", { class: "charts" }, chart("When they said it", "year", years, "Bar length is the number of claims. Click a year to filter."));
    if (cos.length) grid.append(chart("Who it is about", "company", cos, `Top companies named in this cut. ${fmt(unnamed)} claims name no company.`));
    charts.append(grid);
  }

  function renderRows(reset: boolean): void {
    if (reset) { rows.replaceChildren(); shown = 0; }
    const next = current.slice(shown, shown + PAGE);
    rows.append(...next.map(row));
    shown += next.length;
    more.hidden = shown >= current.length;
    if (!more.hidden) more.textContent = `Show ${fmt(Math.min(PAGE, current.length - shown))} more`;
  }

  // The folded filters say how many are on, and open when the address sets one.
  const moreEl = form.querySelector<HTMLDetailsElement>("[data-explore-more]");
  const summaryEl = form.querySelector<HTMLElement>("[data-filter-summary]");
  const summaryText = summaryEl?.textContent ?? "";
  const filtersOn = (): number => SELECT_KEYS.filter((k) => state[k].length && !(k === "kind" && kindRadios.some((r) => r.checked && r.value !== "all"))).length;
  function showFilterCount(): void {
    const on = filtersOn();
    if (summaryEl) summaryEl.textContent = on ? `${summaryText} (${on} on)` : summaryText;
  }
  function update(): void {
    showKind();
    showFilterCount();
    current = pool.filter((c) => pass(c));
    if (state.sort === "oldest") current.reverse();
    // Recently checked: the newest verdicts first, then the newest said.
    if (state.sort === "checked") current.sort((a, b) => (b.checked ?? "").localeCompare(a.checked ?? "") || b.said.localeCompare(a.said) || a.id.localeCompare(b.id));
    const base = locked ? index.claims.filter((c) => c.person === locked).length : index.claims.length;
    const heldHere = current.filter((c) => c.held).length;
    count.textContent = `Showing ${fmt(current.length - heldHere)} of ${fmt(base)} claims${locked ? ` by ${L.person[locked] ?? locked}` : ""}${heldHere ? `, plus ${fmt(heldHere)} held back with a probable call` : ""}.${(() => {
      const off = OUTCOMES.filter((o) => !state.outcome.includes(o)).map((o) => (L.outcome[o] ?? o).toLowerCase());
      if (!off.length) return "";
      const list = off.length === 1 ? off[0] : `${off.slice(0, -1).join(", ")} and ${off.at(-1)}`;
      return ` ${list.charAt(0).toUpperCase()}${list.slice(1)} ${off.length === 1 ? "is" : "are"} hidden. Click above the charts to show ${off.length === 1 ? "it" : "them"}.`;
    })()}`;
    renderOptions();
    renderAnswer();
    renderCharts();
    renderRows(true);
  }

  readUrl();
  showKind();
  if (moreEl && filtersOn()) moreEl.open = true;
  // The page's "How sure?" switch drives the level; the address keeps it.
  const confs = [...document.querySelectorAll<HTMLInputElement>("input[name=conf]")];
  // Without :has() the hero cannot follow the switch, so the page stays strict.
  const canSwitch = typeof CSS !== "undefined" && CSS.supports("selector(:has(*))");
  const fromUrl = canSwitch ? new URL(location.href).searchParams.get("sure") : null;
  if (fromUrl && LEVELS.includes(fromUrl)) { level = fromUrl; const r = confs.find((x) => x.value === fromUrl); if (r) r.checked = true; }
  else level = confs.find((x) => x.checked)?.value ?? "strict";
  for (const r of confs) r.addEventListener("change", () => { if (r.checked) { level = r.value; writeUrl(); update(); } });
  q.value = state.q;
  const showSort = () => { for (const r of sorts) r.checked = r.value === state.sort; };
  showSort();
  for (const r of sorts) r.addEventListener("change", () => { if (r.checked) { state.sort = r.value; writeUrl(); update(); } });
  for (const r of kindRadios) r.addEventListener("change", () => { if (r.checked) { state.kind = [...KIND_SHORTCUT[r.value]]; writeUrl(); update(); } });
  copyLink.hidden = false;
  copyLink.addEventListener("click", () => copyText(location.href, copyLinkStatus));
  update();
  for (const k of SELECT_KEYS) selects[k].addEventListener("change", () => { state[k] = selects[k].value.split(",").filter(Boolean); writeUrl(); update(); });
  let t: number | undefined;
  q.addEventListener("input", () => { clearTimeout(t); t = window.setTimeout(() => { state.q = q.value; writeUrl(); update(); }, 200); });
  form.addEventListener("submit", (e) => { e.preventDefault(); state.q = q.value; writeUrl(); update(); });
  form.querySelector("[data-clear]")?.addEventListener("click", () => { for (const k of KEYS) state[k] = []; state.outcome = [...SETTLED_ONLY]; if (locked) state.person = [locked]; state.q = ""; q.value = ""; state.sort = "newest"; showSort(); writeUrl(); update(); });
  more.addEventListener("click", () => renderRows(false));
}
