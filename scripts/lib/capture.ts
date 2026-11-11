// Capture one source URL: fetch it safely, extract the text, keep the full
// text privately, and write the public projections (document metadata, an
// immutable version named by its text hash, and an append-only fetch event).
// Refetching identical text adds a fetch event and nothing else. A later 404
// or paywall never rewrites an existing version. An archived copy (Wayback
// Machine) can be captured as its own version, labelled with its capture time.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FetchEvent, SourceDocument, SourceVersion, type AccessState, type SourceType } from "../../src/schema.ts";
import { MAX_EXCERPT_WORDS } from "../../src/policy.ts";
import { PUBLICATIONS } from "../../src/config.ts";
import { extract, normalizeText, NORMALIZATION_VERSION, PARSER_VERSION } from "./extract.ts";
import { safeFetch } from "./net.ts";
import { feedAuthorization } from "./feed-auth.ts";
import { putSnapshot } from "./private-store.ts";
import { exists, readJson, writePublic } from "./writer.ts";
import YAML from "yaml";

// Publications come from config/register.yaml: a document on a configured
// host is named after its publication and attributed to its author.
const pubFor = (host: string): { prefix: string; publisher: string; author: string; type: SourceType } | undefined => {
  const p = PUBLICATIONS.get(host);
  return p ? { prefix: p.prefix, publisher: p.name, author: p.subject, type: "newsletter" } : undefined;
};

export const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|r$|s$|triedRedirect$|publication_id$|post_id$|isFreemail$|token$)/.test(k)) u.searchParams.delete(k);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

export function documentIdFor(raw: string): string {
  const u = new URL(canonicalUrl(raw));
  const pub = pubFor(u.hostname);
  const host = pub?.prefix ?? u.hostname.replace(/^www\./, "").replace(/\./g, "-");
  const tail = u.pathname.split("/").filter(Boolean).filter((p) => p !== "p").join("-") || "root";
  const slug = `${host}-${tail}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.length <= 80 ? slug : `${slug.slice(0, 67).replace(/-$/, "")}-${sha(u.toString()).slice(0, 12)}`;
}

function precisionOf(d: string | null): "datetime" | "day" | "month" | "year" | null {
  if (!d) return null;
  if (/T\d{2}:\d{2}/.test(d)) return "datetime";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return "day";
  if (/^\d{4}-\d{2}$/.test(d)) return "month";
  if (/^\d{4}$/.test(d)) return "year";
  return null;
}

// Timestamps in records are UTC to the second.
function toUtc(d: string | null): string | null {
  if (!d) return null;
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d)) return d;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d+Z$/, "Z") : null;
}

function pdfText(buf: Buffer): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-pdf-"));
  try {
    const f = path.join(dir, "doc.pdf");
    fs.writeFileSync(f, buf);
    const r = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", f, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    return r.status === 0 ? r.stdout : null;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export type CaptureResult = {
  document_id: string;
  fetch_event_id: string;
  snapshot_hash: string | null;
  access_state: AccessState;
  new_version: boolean;
  text: string | null;          // the full text, for the caller's private use only
  error: string | null;
};

export type CaptureOptions = {
  sourceType?: SourceType;
  publisher?: string;
  author?: string;
  archiveAt?: string;            // YYYYMMDD: capture the Wayback Machine copy closest to this date instead of the live page
  dryRun?: boolean;
};

async function waybackClosest(url: string, at: string): Promise<{ url: string; timestamp: string } | null> {
  const r = await safeFetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${at}`, { accept: "application/json" });
  if (!r.ok) return null;
  const j = JSON.parse(r.body.toString("utf8"));
  const s = j?.archived_snapshots?.closest;
  if (!s?.available || !s.timestamp) return null;
  return { url: `https://web.archive.org/web/${s.timestamp}id_/${url}`, timestamp: s.timestamp };
}

export async function captureUrl(rawUrl: string, o: CaptureOptions = {}): Promise<CaptureResult> {
  const url = canonicalUrl(rawUrl);
  const host = new URL(url).hostname;
  const pub = pubFor(host);
  const document_id = documentIdFor(url);
  const attempted_at = nowStamp();
  const fetch_event_id = `${document_id.slice(0, 60).replace(/-+$/, "")}-${attempted_at.replace(/[-:]/g, "").toLowerCase()}`;

  let target = url;
  let archive: { url: string; timestamp: string } | null = null;
  if (o.archiveAt) {
    archive = await waybackClosest(url, o.archiveAt);
    if (!archive) return { document_id, fetch_event_id, snapshot_hash: null, access_state: "unavailable", new_version: false, text: null, error: "no archived copy" };
    target = archive.url;
  }
  // Substack refuses GitHub's runners. With PC_SUBSTACK_VIA (the daily update
  // on GitHub) a *.substack.com post page is fetched through the site's own
  // function (functions/feeds/substack-post), which gets the same public page
  // a reader's browser gets. The fetch record names the host it came through.
  const via = process.env.PC_SUBSTACK_VIA;
  const sub = /^([a-z0-9-]+)\.substack\.com$/.exec(host)?.[1];
  const slug = /^\/p\/([a-z0-9-]+)\/?$/.exec(new URL(url).pathname)?.[1];
  const relayed = !!(via && !archive && sub && slug);
  if (relayed) target = `${via!.replace(/\/$/, "")}/feeds/substack-post/${sub}/${slug}`;
  const r = await safeFetch(target, { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5", authorization: relayed ? await feedAuthorization(via!) : undefined });

  let access: AccessState = "unavailable";
  let text: string | null = null;
  let ex: ReturnType<typeof extract> | null = null;
  let error: string | null = null;
  if (!r.ok) {
    access = r.status === 401 || r.status === 403 || r.status === 429 ? "blocked" : (r.status === 404 || r.status === 410) && exists(`data/sources/${document_id}/document.yaml`) ? "deleted" : "unavailable";
    error = r.error;
  } else {
    const isPdf = (r.contentType ?? "").includes("pdf") || r.body.subarray(0, 5).toString("latin1") === "%PDF-";
    if (isPdf) {
      const t = pdfText(r.body);
      text = t ? normalizeText(t) : null;
      access = text ? "full_public" : "unavailable";
      if (!text) error = "pdftotext could not read the PDF";
    } else {
      const html = r.body.toString("utf8");
      if (/<title>\s*(just a moment|attention required|access denied)/i.test(html)) { access = "blocked"; error = "bot challenge"; }
      else {
        ex = extract(html, url);
        text = ex.text;
        access = ex.paywalled ? "public_preview" : "full_public";
        if (!text) { access = "unavailable"; error = "no article text found"; }
      }
    }
  }

  const snapshot_hash = text ? sha(text) : null;
  const versionRel = snapshot_hash ? `data/sources/${document_id}/versions/${snapshot_hash}.json` : null;
  const new_version = !!versionRel && !exists(versionRel);
  if (o.dryRun) return { document_id, fetch_event_id, snapshot_hash, access_state: access, new_version, text, error };

  // Document metadata: written once; later fetches never rewrite it.
  const docRel = `data/sources/${document_id}/document.yaml`;
  if (!exists(docRel) && (text || ex)) {
    const published = toUtc(ex?.publishedAt ?? null);
    writePublic(docRel, SourceDocument, {
      document_id, canonical_url: url, title: (ex?.title || url).slice(0, 300), publisher: o.publisher ?? pub?.publisher ?? host,
      original_author: o.author ?? pub?.author ?? "unknown", source_type: o.sourceType ?? pub?.type ?? "other",
      original_published_at: published, original_date_precision: precisionOf(published), original_date_provenance: ex?.dateProvenance ?? "none found",
      original_date_uncertain: !published, discovered_at: attempted_at,
    });
  }
  if (text && snapshot_hash) {
    putSnapshot(snapshot_hash, text, { url, final_url: r.ok ? r.finalUrl : null, archive: archive?.url ?? null, observed_at: attempted_at, parser: PARSER_VERSION, normalization: NORMALIZATION_VERSION });
    if (new_version) {
      const archivedAt = archive ? `${archive.timestamp.slice(0, 4)}-${archive.timestamp.slice(4, 6)}-${archive.timestamp.slice(6, 8)}T${archive.timestamp.slice(8, 10)}:${archive.timestamp.slice(10, 12)}:${archive.timestamp.slice(12, 14)}Z` : null;
      writePublic(versionRel!, SourceVersion, {
        snapshot_hash, document_id, first_observed_at: attempted_at, observed_via: archive ? "archive" : "live", archive_url: archive ? `https://web.archive.org/web/${archive.timestamp}/${url}` : null,
        archive_captured_at: archivedAt, access_state: access, context_completeness: access === "full_public" ? "complete" : "partial",
        parser_version: PARSER_VERSION, normalization_version: NORMALIZATION_VERSION, chars: text.length,
        public_excerpt_policy: { max_words: MAX_EXCERPT_WORDS }, private_retained: true,
      });
    }
  }
  const finalHost = r.finalUrl ? new URL(r.finalUrl).hostname : null;
  writePublic(`data/source-fetches/${fetch_event_id}.json`, FetchEvent, {
    fetch_event_id, document_id, url: archive ? `https://web.archive.org/web/${archive.timestamp}/${url}` : url, attempted_at, retrieved_at: r.ok ? nowStamp() : null,
    http_status: r.status, access_state: access, observed_modified_at: r.ok && r.lastModified ? toUtc(r.lastModified) : null,
    content_type: r.ok ? (r.contentType ?? null)?.slice(0, 120) ?? null : null, bytes: r.ok ? r.body.length : null, final_host: finalHost,
    snapshot_hash, error: error?.slice(0, 400) ?? null,
  });
  return { document_id, fetch_event_id, snapshot_hash, access_state: access, new_version, text, error };
}

export function readDocument(id: string) {
  return YAML.parse(fs.readFileSync(`data/sources/${id}/document.yaml`, "utf8"));
}
export { readJson };
