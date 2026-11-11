// Finding a quotation in a stored source version. Exact first; then a narrow
// normalisation that only straightens quotation marks and dashes, expands an
// ellipsis character, and collapses whitespace. It never changes letters,
// digits, signs, or negation, and never drops punctuation, so a quotation that
// matches says what the source says. Offsets always refer to the stored text.
import { createHash } from "node:crypto";

export const QUOTE_NORMALIZATION = "quote-norm-1";

export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true; // trims leading space
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (/[‘’‚‛′ʼ]/.test(ch)) ch = "'";
    else if (/[“”„‟″]/.test(ch)) ch = '"';
    else if (/[‐-―−]/.test(ch)) ch = "-";
    else if (ch === "…") ch = "...";
    else if (/\s/.test(ch)) ch = " ";
    if (ch === " ") {
      if (lastSpace) continue;
      lastSpace = true;
    } else lastSpace = false;
    for (const c of ch) { norm += c; map.push(i); }
  }
  if (norm.endsWith(" ")) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}

export type QuoteMatch =
  | { status: "exact" | "normalized"; start: number; end: number; text: string; occurrences: number }
  | { status: "failed"; reason: string };

export function locateQuote(source: string, quote: string): QuoteMatch {
  const q = quote.trim();
  if (q.length < 12) return { status: "failed", reason: "a quotation is at least 12 characters" };
  const exact = source.indexOf(q);
  if (exact >= 0) {
    let n = 0;
    for (let at = exact; at >= 0; at = source.indexOf(q, at + 1)) n++;
    return { status: "exact", start: exact, end: exact + q.length, text: q, occurrences: n };
  }
  const S = normalizeWithMap(source);
  const Q = normalizeWithMap(q).norm;
  const at = S.norm.indexOf(Q);
  if (at < 0) return { status: "failed", reason: "the quotation is not in this source version" };
  let n = 0;
  for (let x = at; x >= 0; x = S.norm.indexOf(Q, x + 1)) n++;
  const start = S.map[at];
  const end = S.map[at + Q.length - 1] + 1;
  return { status: "normalized", start, end, text: source.slice(start, end), occurrences: n };
}

// The public excerpt is a contiguous part of the verified quotation.
export function excerptInQuote(quote: string, excerpt: string): boolean {
  return normalizeWithMap(quote).norm.includes(normalizeWithMap(excerpt.trim()).norm);
}

export const quoteHash = (exactText: string): string => createHash("sha256").update(exactText).digest("hex");
