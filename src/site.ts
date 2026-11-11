// Site settings, read from config/register.yaml so no page retypes them.
// Nothing in this file describes a claim; the people covered are listed in
// the configuration, not here.
import { CONFIG, SUBJECT_NAMES } from "./config.ts";

const ORIGIN_DEFAULT = "https://punditclaims.ai"; // registered 2026-10-28; same default as astro.config.mjs

export const SITE = {
  name: CONFIG.site.name,
  topic: CONFIG.site.topic,
  subjects: SUBJECT_NAMES,
  tagline: `${CONFIG.site.topic} claims by ${SUBJECT_NAMES}, with the evidence`,
  description: CONFIG.site.description,
  // Every canonical and absolute URL starts here. Set PC_SITE_ORIGIN for a
  // real deployment; only then do pages ask to be indexed.
  origin: (process.env.PC_SITE_ORIGIN || ORIGIN_DEFAULT).replace(/\/+$/, ""),
  // Pages ask search engines to index them only when the origin was set on
  // purpose and the build carries a real (non-fixture) release.
  originExplicit: Boolean(process.env.PC_SITE_ORIGIN),
  // The public repository that receives dispute issues.
  repo: CONFIG.site.repository,
  editor: CONFIG.site.editor,
  editorLinks: CONFIG.site.editor_links,
  essay: CONFIG.site.provenance ? { title: CONFIG.site.provenance.title, url: CONFIG.site.provenance.url } : null,
  provenanceNote: CONFIG.site.provenance?.note ?? null,
  publications: CONFIG.subjects.flatMap((s) => s.publications.map((p) => p.name)),
} as const;

// Each person's photo and its credit, by subject id, when configured.
export const PHOTOS = Object.fromEntries(CONFIG.subjects.filter((s) => s.photo).map((s) => [s.id, s.photo!]));

// The private route for privacy, rights, or safety problems with quoted text.
export const PRIVATE_CONTACT: string | null = CONFIG.site.private_contact;

export const absolute = (path: string): string => `${SITE.origin}${path.startsWith("/") ? path : `/${path}`}`;
