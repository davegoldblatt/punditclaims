// URL-backed filters for a list marked [data-filter-root]. The page renders
// every item and every count from the release; this script only hides,
// reorders, and recounts what is already there. Filters live in the query
// string, so a filtered view survives reload, sharing, and back/forward.
// Search uses the Pagefind index built from the same release; if the index
// is missing it falls back to matching the row text. Nothing here fetches
// anything but this site's own Pagefind files. A list split into pages has no
// filter form, and this script then does nothing.

type Facet = { name: string; el: HTMLSelectElement; multi: boolean };

let pagefind: Promise<any | null> | null = null;
function loadPagefind(): Promise<any | null> {
  const url = "/pagefind/pagefind.js";
  pagefind ??= import(/* @vite-ignore */ url)
    .then(async (pf) => { await pf.init?.(); return pf; })
    .catch(() => null);
  return pagefind;
}

const ORDER_TEXT: Record<string, string> = {
  said: "newest first",
  changed: "most recently changed first",
};

export function initFilters(root: HTMLElement): void {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";
  const form = root.querySelector<HTMLFormElement>("[data-filters]");
  const list = root.querySelector<HTMLElement>("[data-list]");
  if (!form || !list) return;
  const items = Array.from(list.querySelectorAll<HTMLElement>("[data-item]"));
  const facets: Facet[] = Array.from(form.querySelectorAll<HTMLSelectElement>("select[data-facet]"))
    .map((el) => ({ name: el.name, el, multi: el.dataset.facet === "multi" }));
  const sortEl = form.querySelector<HTMLSelectElement>("select[name=sort]");
  const qEl = form.querySelector<HTMLInputElement>("input[name=q]");
  const shown = root.querySelector<HTMLElement>("[data-shown]");
  const orderText = root.querySelector<HTMLElement>("[data-order-text]");
  const empty = root.querySelector<HTMLElement>("[data-empty]");
  const note = root.querySelector<HTMLElement>("[data-note]");
  // On narrow screens the facets sit in a closed disclosure; it opens when
  // the screen is wide or when the address already sets a filter.
  const more = form.querySelector<HTMLDetailsElement>("[data-filter-more]");
  const activeCount = form.querySelector<HTMLElement>("[data-active-count]");
  form.hidden = false;

  const has = (item: HTMLElement, f: Facet, v: string): boolean => {
    const raw = item.dataset[f.name] ?? "";
    return f.multi ? raw.split(" ").includes(v) : raw === v;
  };

  async function matchIds(q: string): Promise<Set<string> | null> {
    if (!q) return null;
    const pf = await loadPagefind();
    if (pf) {
      const res = await pf.search(q);
      if (res) {
        // The index holds post pages; each claim on one is a section whose
        // anchor is c-<claim id>. Only sections that match come back.
        const data = await Promise.all(res.results.map((r: any) => r.data()));
        const ids = new Set<string>();
        for (const d of data) for (const s of d?.sub_results ?? []) {
          const m = /#c-([a-z0-9-]+)$/.exec(s.url ?? "");
          if (m) ids.add(m[1]);
        }
        return ids;
      }
    }
    const needle = q.toLowerCase();
    return new Set(items.filter((i) => (i.textContent ?? "").toLowerCase().includes(needle)).map((i) => i.dataset.id ?? ""));
  }

  let seq = 0;
  async function apply(): Promise<void> {
    const mine = ++seq;
    const hits = await matchIds(qEl?.value.trim() ?? "");
    if (mine !== seq) return; // a newer change arrived while searching
    const chosen = new Map(facets.map((f) => [f.name, f.el.value]));
    const pass = (it: HTMLElement, skip?: string): boolean =>
      facets.every((f) => f.name === skip || !chosen.get(f.name) || has(it, f, chosen.get(f.name)!)) &&
      (!hits || hits.has(it.dataset.id ?? ""));
    let n = 0;
    for (const it of items) { const ok = pass(it); it.hidden = !ok; if (ok) n++; }
    // Each option's count: items that match every other active filter.
    for (const f of facets) {
      for (const o of Array.from(f.el.options)) {
        const c = items.filter((it) => pass(it, f.name) && (!o.value || has(it, f, o.value))).length;
        o.text = `${o.dataset.label ?? o.value} (${c})`;
      }
    }
    if (sortEl) {
      const k = sortEl.value === "changed" ? "changed" : "said";
      const sorted = [...items].sort((a, b) => (b.dataset[k] ?? "").localeCompare(a.dataset[k] ?? "") || (a.dataset.id ?? "").localeCompare(b.dataset.id ?? ""));
      for (const it of sorted) list!.append(it);
      if (orderText) orderText.textContent = ORDER_TEXT[k];
    }
    if (shown) shown.textContent = String(n);
    if (empty) empty.hidden = n > 0;
    const on = facets.filter((f) => f.el.value).length + (sortEl && sortEl.value !== sortEl.options[0].value ? 1 : 0);
    if (activeCount) activeCount.textContent = on ? ` (${on} set)` : "";
  }

  function readUrl(): void {
    const p = new URLSearchParams(location.search);
    const unknown: string[] = [];
    for (const f of facets) {
      const v = p.get(f.name) ?? "";
      const ok = !v || Array.from(f.el.options).some((o) => o.value === v);
      if (!ok) unknown.push(`${f.el.dataset.title} “${v}”`);
      f.el.value = ok ? v : "";
    }
    if (sortEl) {
      const v = p.get("sort") ?? "";
      const ok = !v || Array.from(sortEl.options).some((o) => o.value === v);
      if (!ok) unknown.push(`${sortEl.dataset.title} “${v}”`);
      sortEl.value = ok && v ? v : sortEl.options[0].value;
    }
    if (qEl) qEl.value = p.get("q") ?? "";
    if (note) {
      note.hidden = unknown.length === 0;
      note.textContent = unknown.length
        ? `This address asked for ${unknown.join(" and ")}, which this release does not have. ${unknown.length === 1 ? "That filter is" : "Those filters are"} off.`
        : "";
    }
  }

  function writeUrl(push: boolean): void {
    const p = new URLSearchParams(location.search);
    for (const f of facets) { if (f.el.value) p.set(f.name, f.el.value); else p.delete(f.name); }
    if (sortEl) { if (sortEl.value !== sortEl.options[0].value) p.set("sort", sortEl.value); else p.delete("sort"); }
    if (qEl) { const q = qEl.value.trim(); if (q) p.set("q", q); else p.delete("q"); }
    const qs = p.toString();
    const next = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
    if (next === `${location.pathname}${location.search}${location.hash}`) return;
    if (push) history.pushState(null, "", next); else history.replaceState(null, "", next);
  }

  const changed = (push: boolean) => { if (note) note.hidden = true; writeUrl(push); void apply(); };
  for (const f of facets) f.el.addEventListener("change", () => changed(true));
  sortEl?.addEventListener("change", () => changed(true));
  let timer: number | undefined;
  qEl?.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(() => changed(false), 250); });
  qEl?.addEventListener("change", () => { clearTimeout(timer); changed(true); });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); changed(true); });
  for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-clear]"))) {
    b.addEventListener("click", () => {
      for (const f of facets) f.el.value = "";
      if (sortEl) sortEl.value = sortEl.options[0].value;
      if (qEl) qEl.value = "";
      changed(true);
      (qEl ?? facets[0]?.el)?.focus();
    });
  }
  addEventListener("popstate", () => { readUrl(); void apply(); });
  readUrl();
  if (more) {
    const set = facets.some((f) => f.el.value) || (!!sortEl && sortEl.value !== sortEl.options[0].value);
    more.open = set || matchMedia("(min-width: 768px)").matches;
  }
  void apply();
}
