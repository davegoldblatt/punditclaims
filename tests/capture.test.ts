// Source capture without the network: URL and address checks, extraction and
// paywall markers, quotation matching, and the public writer's refusals.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkUrl, isBlockedAddress } from "../scripts/lib/net.ts";
import { extract } from "../scripts/lib/extract.ts";
import { excerptInQuote, locateQuote } from "../scripts/lib/quote.ts";
import { canonicalUrl, documentIdFor } from "../scripts/lib/capture.ts";

test("only public https addresses are fetched", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1", "192.0.2.10", "198.51.100.7"]) assert.ok(isBlockedAddress(ip), ip);
  for (const ip of ["93.184.216.34", "151.101.1.140", "192.0.66.2", "2606:4700::6810:84e5"]) assert.equal(isBlockedAddress(ip), null, ip);
  assert.equal(checkUrl("http://example.org/").ok, false);
  assert.equal(checkUrl("https://user:pw@example.org/").ok, false);
  assert.equal(checkUrl("https://example.org:8443/").ok, false);
  assert.equal(checkUrl("https://127.0.0.1/").ok, false);
  assert.equal(checkUrl("https://[::1]/").ok, false);
  assert.equal(checkUrl("https://printer.local/").ok, false);
  assert.equal(checkUrl("https://example.org/a?b=1").ok, true);
});

test("document ids and canonical URLs are stable", () => {
  assert.equal(canonicalUrl("https://garymarcus.substack.com/p/some-post?utm_source=x&r=abc#footnote"), "https://garymarcus.substack.com/p/some-post");
  assert.equal(documentIdFor("https://garymarcus.substack.com/p/some-post?utm_source=x"), "marcus-some-post");
  assert.equal(documentIdFor("https://www.wheresyoured.at/peakai/"), "wyea-peakai");
  assert.match(documentIdFor("https://www.sec.gov/Archives/edgar/data/2130357/000162828026067168/anthropicpbc-sx1.htm"), /^sec-gov-archives-edgar/);
  assert.ok(documentIdFor(`https://example.org/${"x".repeat(200)}`).length <= 80);
});

const ghost = (cls: string, extra = "") => `<html><head><meta name="generator" content="Ghost 6.0"><style>.gh-post-upgrade-cta{display:flex}.content-cta{}</style><meta property="article:published_time" content="2024-03-18T15:00:00.000Z"><meta property="og:title" content="A post"></head><body><article class="post ${cls}"><p>First paragraph with “curly quotes” — and a dash.</p><p>Second   paragraph.</p>${extra}</article></body></html>`;

test("source-access: paywall markers are read from markup, not stylesheets", () => {
  const free = extract(ghost("content post-access-public"), "https://www.wheresyoured.at/a/");
  assert.equal(free.paywalled, false);
  assert.equal(free.publishedAt, "2024-03-18T15:00:00.000Z");
  assert.equal(free.dateProvenance, "article:published_time meta");
  assert.equal(free.text, "First paragraph with “curly quotes” — and a dash.\n\nSecond paragraph.");
  const paid = extract(ghost("content post-access-paid", '<div class="content-cta"><p>for paying subscribers only</p></div>'), "https://www.wheresyoured.at/b/");
  assert.equal(paid.paywalled, true);
  assert.ok(!paid.text.includes("paying subscribers"), "the call to action is not article text");
});

test("source-access: a Substack post for subscribers only is a preview", () => {
  const page = (aud: string) => `<html><head><script>window._preloads = {"post":{"slug":"x","audience":"${aud}"}}</script></head><body><div class="available-content"><p>Opening paragraph only.</p></div></body></html>`;
  assert.equal(extract(page("only_subscribers"), "https://garymarcus.substack.com/p/x").paywalled, true);
  assert.equal(extract(page("only_paid"), "https://garymarcus.substack.com/p/x").paywalled, true);
  assert.equal(extract(page("everyone"), "https://garymarcus.substack.com/p/x").paywalled, false);
});

test("quotations match exactly or under the narrow normalisation only", () => {
  const src = "He wrote: “GPT-5 won’t land this year.” Then he added — firmly — that it was 10% likely.";
  const exact = locateQuote(src, "Then he added — firmly — that it was 10% likely.");
  assert.equal(exact.status, "exact");
  const norm = locateQuote(src, `"GPT-5 won't land this year."`);
  assert.equal(norm.status, "normalized");
  if (norm.status !== "failed") assert.equal(norm.text, "“GPT-5 won’t land this year.”");
  // A change of number, sign, or negation never matches.
  assert.equal(locateQuote(src, "that it was 11% likely.").status, "failed");
  assert.equal(locateQuote(src, `"GPT-5 will land this year."`).status, "failed");
  assert.equal(locateQuote(src, "Then he added firmly that it was 10% likely.").status, "failed", "dropped punctuation is not a match");
  assert.equal(excerptInQuote("“GPT-5 won’t land this year.”", `GPT-5 won't land`), true);
  assert.equal(excerptInQuote("“GPT-5 won’t land this year.”", "GPT-5 will land"), false);
});

test("the public writer refuses paths outside data/, symlinks, extra fields, and rewrites of immutable records", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-writer-"));
  fs.mkdirSync(path.join(root, "data"));
  process.env.PC_ROOT = root;
  const { writePublic } = await import(`../scripts/lib/writer.ts?root=${Date.now()}`);
  const { FetchEvent } = await import("../src/schema.ts");
  const ev = { fetch_event_id: "x-1", document_id: "x", url: "https://example.org/", attempted_at: "2026-10-28T00:00:00Z", retrieved_at: null, http_status: 404, access_state: "unavailable", observed_modified_at: null, content_type: null, bytes: null, final_host: null, snapshot_hash: null, error: "HTTP 404" };
  writePublic("data/source-fetches/x-1.json", FetchEvent, ev);
  assert.doesNotThrow(() => writePublic("data/source-fetches/x-1.json", FetchEvent, ev), "an identical rewrite is a no-op");
  assert.throws(() => writePublic("data/source-fetches/x-1.json", FetchEvent, { ...ev, error: "changed" }), /immutable/);
  assert.throws(() => writePublic("data/source-fetches/x-2.json", FetchEvent, { ...ev, fetch_event_id: "x-2", full_text: "the whole article" }), /not a valid public record/);
  assert.throws(() => writePublic("../escape.json", FetchEvent, ev), /refusing/);
  assert.throws(() => writePublic("src/x.json", FetchEvent, ev), /outside data/);
  fs.symlinkSync(os.tmpdir(), path.join(root, "data", "link"));
  assert.throws(() => writePublic("data/link/x.json", FetchEvent, ev), /symlink/);
  delete process.env.PC_ROOT;
});

test("duplicates", async () => {
  const { mergeReceipts } = await import("../scripts/lib/draft.ts");
  const { computeCounts } = await import("../src/lib/published.ts");
  const r = (snap: string, qh: string) => ({ source_snapshot_id: snap.repeat(64), source_span: { start: 1, end: 9 }, public_excerpt: "words", excerpt_locator: "p1", quote_hash: qh.repeat(64), quote_verification: { status: "exact" as const, normalization_version: "1", verified_at: "2026-10-28T00:00:00Z", excerpt_in_quote: true } });
  const first = mergeReceipts(null, r("a", "1"));
  const occ = { id: "fx-o", subject_id: "gary-marcus" as const, document_id: "fx-d", attributed_speaker: "gary-marcus", endorsement_status: "endorsed" as const, statement_date: "2024-01-01", statement_date_precision: "day" as const, extraction_run: "x", claim_ids: ["fx-c"], source_version_receipts: first.receipts, continuity: first.continuity };
  // An unrelated page edit: same words, new version: one occurrence, two receipts.
  const edited = mergeReceipts(occ, r("b", "1"));
  assert.equal(edited.receipts.length, 2);
  assert.equal(edited.continuity.status, "continued");
  // Changed words are flagged, not merged silently.
  assert.equal(mergeReceipts(occ, r("c", "2")).continuity.status, "ambiguous");
  // Re-observing the same version replaces its receipt rather than adding one.
  assert.equal(mergeReceipts({ ...occ, source_version_receipts: edited.receipts }, r("b", "1")).receipts.length, 2);
  // Repeated statements count once as a claim.
  const fixture = JSON.parse(fs.readFileSync("fixtures/release/manifest.json", "utf8"));
  const c = computeCounts(fixture.claims, 0);
  const repeated = fixture.claims.find((x: { claim_id: string }) => x.claim_id === "fx-review-due");
  assert.equal(repeated.occurrences.length, 3);
  assert.equal(c.distinct_claims, fixture.claims.filter((x: { current: unknown }) => x.current).length);
  assert.ok(c.occurrences > c.distinct_claims);
});
