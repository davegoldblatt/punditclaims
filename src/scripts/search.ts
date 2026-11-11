// The /search page: query the Pagefind index built from this release and list
// the matching claims. The index reads the source post pages, where each claim
// is a section whose anchor is c-<claim id>; a matching section becomes one
// result that links to the claim's own page. The method and about pages are
// listed as pages. The query lives in ?q=, so a search can be shared and
// survives reload and back/forward. Excerpts are escaped; only Pagefind's
// <mark> highlighting is kept.

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const highlight = (excerpt: string): string => {
  // Pagefind returns text with <mark> around matches. Decode nothing; escape
  // everything, then restore only the mark tags.
  return esc(excerpt).replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
};
const cleanUrl = (u: string): string => u.replace(/\.html(?=$|#)/, "").replace(/\/index$/, "/");

// Pages whose data is loaded per search. Each post page holds every claim
// from that post, so this bounds the work, not the claims shown from them.
const PAGES = 30;

type Hit = { url: string; title: string; excerpt: string; bits: string[] };

export function runSearchPage(): void {
  const form = document.querySelector<HTMLFormElement>("[data-search-form]");
  const input = form?.querySelector<HTMLInputElement>("input[name=q]");
  const status = document.querySelector<HTMLElement>("[data-search-status]");
  const list = document.querySelector<HTMLOListElement>("[data-search-results]");
  if (!form || !input || !status || !list) return;
  let labels: string[] = [];
  try { labels = JSON.parse(list.dataset.labels ?? "[]"); } catch { labels = []; }
  let pf: any = null;
  let seq = 0;

  async function load(): Promise<any> {
    if (pf) return pf;
    const url = "/pagefind/pagefind.js";
    pf = await import(/* @vite-ignore */ url);
    await pf.init?.();
    return pf;
  }

  // The claim's assessment label follows its heading in the page text, after
  // the words "Assessment:". Absent or unknown, no label is shown.
  function labelAfter(content: string, title: string): string | null {
    const i = content.indexOf(title);
    if (i < 0) return null;
    const rest = content.slice(i + title.length, i + title.length + 120);
    const m = /Assessment:\s*/.exec(rest);
    if (!m) return null;
    const after = rest.slice(m.index + m[0].length);
    return labels.find((l) => after.startsWith(l)) ?? null;
  }

  async function run(q: string): Promise<void> {
    const mine = ++seq;
    if (!q) { list!.replaceChildren(); status!.textContent = ""; return; }
    status!.textContent = "Searching…";
    let p: any;
    try { p = await load(); } catch { status!.textContent = "The search index is not available on this build."; return; }
    const res = await p.search(q);
    const data = await Promise.all(res.results.slice(0, PAGES).map((r: any) => r.data()));
    if (mine !== seq) return;
    const hits: Hit[] = [];
    const seen = new Set<string>();
    let claims = 0;
    for (const d of data) {
      const meta = d.meta ?? {};
      const subs = (d.sub_results ?? []).filter((s: any) => /#c-[a-z0-9-]+$/.test(s.url ?? ""));
      if (!subs.length) {
        hits.push({ url: cleanUrl(d.url), title: meta.title ?? d.url, excerpt: d.excerpt ?? "", bits: [meta.page].filter(Boolean) });
        continue;
      }
      for (const s of subs) {
        const id = /#c-([a-z0-9-]+)$/.exec(s.url)![1];
        if (seen.has(id)) continue; // a claim said in two posts is listed once
        seen.add(id);
        claims++;
        const label = labelAfter(d.content ?? "", s.title ?? "");
        hits.push({ url: `/claims/${id}`, title: s.title ?? id, excerpt: s.excerpt ?? "", bits: [meta.person, label, meta.title ? `From “${meta.title}”` : ""].filter(Boolean) });
      }
    }
    const pages = hits.length - claims;
    const more = res.results.length > PAGES;
    status!.textContent = hits.length
      ? `${claims} ${claims === 1 ? "claim" : "claims"}${pages ? ` and ${pages} ${pages === 1 ? "page" : "pages"}` : ""} match “${q}”.${more ? ` They come from the ${PAGES} best-matching of ${res.results.length} posts and pages. Add words to narrow the search.` : ""}`
      : `Nothing matches “${q}”. Try fewer or different words, or browse the register.`;
    list!.innerHTML = hits.map((h) => {
      const bits = h.bits.map((x) => esc(x)).join(". ");
      return `<li><h2><a href="${esc(h.url)}">${esc(h.title)}</a></h2>${bits ? `<p class="soft">${bits}.</p>` : ""}<p>${highlight(h.excerpt)}</p></li>`;
    }).join("");
  }

  const fromUrl = () => { const q = new URLSearchParams(location.search).get("q") ?? ""; input.value = q; void run(q.trim()); };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    const next = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    if (`${location.pathname}${location.search}` !== next) history.pushState(null, "", next);
    void run(q);
  });
  addEventListener("popstate", fromUrl);
  fromUrl();
}
