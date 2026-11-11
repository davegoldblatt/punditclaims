// HTML to article text and metadata, with no model. Knows the two subjects'
// platforms (Substack for Marcus on AI, Ghost for Where's Your Ed At) and
// falls back to <article>/<main> for other publishers. Paywall markers make a
// page a preview, whatever its length; a short page with no marker is not
// called incomplete just for being short.
export const PARSER_VERSION = "extract-1";
export const NORMALIZATION_VERSION = "norm-1";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", rsquor: "’", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", times: "×", minus: "−", middot: "·", deg: "°" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, b: string) => {
    if (b[0] === "#") {
      const n = b[1].toLowerCase() === "x" ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENT[b] ?? ENT[b.toLowerCase()] ?? all;
  });
}

// The stored text form. Paragraphs are separated by a blank line; spaces
// inside a paragraph are collapsed; Unicode is NFC (never NFKC, which can
// change characters). Quotation marks, dashes, numbers, and signs are kept as
// published.
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t\f\v   ]+/g, " ")
    .split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|template|iframe|canvas|button|form|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<(br|hr)\b[^>]*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|dd|dt|figcaption|caption|table|ul|ol)\s*>/gi, "\n\n");
  s = s.replace(/<\/(td|th)\s*>/gi, "\t");
  s = s.replace(/<[^>]+>/g, "");
  return normalizeText(decodeEntities(s));
}

const meta = (html: string, key: string): string | null => {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  const c = tag && /content=["']([^"']*)["']/i.exec(tag);
  return c ? decodeEntities(c[1]).trim() : null;
};

function jsonLdDate(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const node of Array.isArray(j) ? j : [j, ...(j["@graph"] ?? [])]) if (node?.datePublished) return String(node.datePublished);
    } catch {}
  }
  return null;
}

// Cut the body out of a page by the platform's own container.
function sliceBetween(html: string, open: RegExp, stopAt: RegExp[]): string | null {
  const m = open.exec(html);
  if (!m) return null;
  let rest = html.slice(m.index);
  let cut = rest.length;
  for (const s of stopAt) { const x = s.exec(rest); if (x && x.index > 0 && x.index < cut) cut = x.index; }
  return rest.slice(0, cut);
}

export type Extracted = {
  platform: "substack" | "ghost" | "generic";
  title: string;
  canonical: string | null;
  author: string | null;
  publishedAt: string | null;       // as the page states it
  dateProvenance: string;
  paywalled: boolean;
  text: string;
};

const SUBSTACK_PAYWALL = /class="[^"]*\bpaywall\b|This post is for paid subscribers|data-component-name="Paywall/i;
// Ghost themes mark a locked post on its <article> (post-access-paid,
// post-access-members, post-access-tiers) and show a sneak peek and a CTA.
// Theme CSS carries the CTA class names on every page, so markers are only
// looked for after <style> and <script> are removed.
const GHOST_PAYWALL = /post-access-(paid|members|tiers)|post-sneak-peek|class="[^"]*\b(gh-post-upgrade-cta|content-cta)\b/i;
const GHOST_PUBLIC = /<article\b[^>]*class="[^"]*\bpost-access-public\b/i;
const markup = (html: string) => html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

export function extract(html: string, url: string): Extracted {
  const host = new URL(url).hostname;
  const generator = meta(html, "generator") ?? "";
  const platform: Extracted["platform"] = /substack/i.test(host) || /substackcdn|substack\.com/.test(html.slice(0, 20000)) ? "substack" : /ghost/i.test(generator) || /gh-content|ghost-/.test(html) ? "ghost" : "generic";
  const title = meta(html, "og:title") ?? decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ?? /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html)?.[1] ?? null;
  let publishedAt = meta(html, "article:published_time");
  let dateProvenance = publishedAt ? "article:published_time meta" : "";
  if (!publishedAt) { publishedAt = jsonLdDate(html); if (publishedAt) dateProvenance = "JSON-LD datePublished"; }
  if (!publishedAt && platform === "substack") {
    const m = /"post_date":"([^"]+)"/.exec(html);
    if (m) { publishedAt = m[1]; dateProvenance = "Substack post_date"; }
  }
  const author = meta(html, "author") ?? meta(html, "article:author");
  let body: string | null = null;
  let paywalled = false;
  if (platform === "substack") {
    body = sliceBetween(html, /<div[^>]+class="[^"]*\bavailable-content\b/i, [/<div[^>]+class="[^"]*\b(post-footer|paywall)\b/i, /<div[^>]+data-component-name="Paywall/i])
      ?? sliceBetween(html, /<div[^>]+class="[^"]*\bbody markup\b/i, [/<div[^>]+class="[^"]*\bpost-footer\b/i]);
    // A post for subscribers only (free or paid) shows a preview with no paywall
    // markup; the page's own post record says so in its audience field.
    const audience = /"audience":"([a-z_]+)"/.exec(html)?.[1] ?? null;
    paywalled = SUBSTACK_PAYWALL.test(markup(html)) || (audience !== null && audience !== "everyone");
  } else if (platform === "ghost") {
    body = sliceBetween(html, /<(section|div)[^>]+class="[^"]*\b(gh-content|post-content|article-content)\b/i, [/<(footer|aside)[^>]+class="[^"]*\b(gh-post-upgrade-cta|post-footer|article-footer|gh-article-footer|gh-comments)\b/i, /<footer\b/i])
      ?? sliceBetween(html, /<article\b[^>]*class="[^"]*\bpost\b/i, [/<\/article>/i, /<(div|section)[^>]+class="[^"]*\bcontent-cta\b/i]);
    const m = markup(html);
    paywalled = !GHOST_PUBLIC.test(m) && GHOST_PAYWALL.test(m);
  }
  if (!body) body = sliceBetween(html, /<article\b/i, [/<\/article>/i]) ?? sliceBetween(html, /<main\b/i, [/<\/main>/i]) ?? html;
  return { platform, title, canonical, author, publishedAt, dateProvenance: dateProvenance || "none found", paywalled, text: htmlToText(body) };
}
