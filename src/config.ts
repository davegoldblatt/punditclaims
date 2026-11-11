// The deployment's configuration: the site, the people it covers, where their
// statements are published, and the collection windows. Everything specific
// to one register lives in config/register.yaml (or the file PC_CONFIG names);
// all code reads it from here. Read at build and run time, never in a browser.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Https = z.string().url().refine((u) => u.startsWith("https://"), "an https URL");

// evaluate_as_of: the evidence date for claims first checked from this window.
// Unset, it follows retrieval_cutoff (scripts/lib/evaluation.ts).
// rolling: the daily update moves `to` (and retrieval_cutoff) to the run date
// (scripts/roll-windows.ts). A rolling window never sets evaluate_as_of.
export const Window = z.object({ id: Slug, publication: z.string().min(1), origin: Https, from: Day, to: Day, basis: z.string().min(1), discover: z.boolean().default(true), evaluate_as_of: Day.optional(), rolling: z.boolean().default(false) }).strict();
export const Publication = z.object({ name: z.string().min(1), origin: Https, platform: z.enum(["substack", "ghost", "generic"]), prefix: Slug, aliases: z.array(z.string()).default([]) }).strict();
// A photo of the person, self-hosted under public/, with the credit its licence requires.
export const Photo = z.object({ file: z.string().regex(/^\/[a-z0-9/-]+\.jpg$/), credit: z.string().min(1), license: z.string().min(1), license_url: Https, source_url: Https, note: z.string().optional() }).strict();
export const SubjectConfig = z.object({ id: Slug, name: z.string().min(1), photo: Photo.optional(), publications: z.array(Publication).min(1), windows: z.array(Window).min(1) }).strict();
export const RegisterConfig = z.object({
  site: z.object({
    name: z.string().min(1), topic: z.string().min(1), description: z.string().min(1), repository: Https, editor: z.string().min(1),
    // The editor's public pages, shown on the about page.
    editor_links: z.array(z.object({ label: z.string().min(1), text: z.string().min(1), url: Https }).strict()).default([]),
    private_contact: z.string().email().nullable(), provenance: z.object({ title: z.string(), url: Https, note: z.string() }).strict().nullable(),
  }).strict(),
  subjects: z.array(SubjectConfig).min(1),
  retrieval_cutoff: Day,
}).strict().superRefine((c, ctx) => {
  const ids = c.subjects.map((s) => s.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "subject ids repeat", path: ["subjects"] });
  const w = c.subjects.flatMap((s) => s.windows.map((x) => x.id));
  if (new Set(w).size !== w.length) ctx.addIssue({ code: "custom", message: "window ids repeat", path: ["subjects"] });
});
export type RegisterConfig = z.infer<typeof RegisterConfig>;

const file = path.resolve(process.env.PC_CONFIG ?? path.join(process.env.PC_ROOT ?? process.cwd(), "config/register.yaml"));
export const CONFIG: RegisterConfig = RegisterConfig.parse(YAML.parse(fs.readFileSync(file, "utf8")));

// "A and B"; "A, B, and C".
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
export const SUBJECT_NAMES = joinNames(CONFIG.subjects.map((s) => s.name));
export const subjectName = (id: string) => CONFIG.subjects.find((s) => s.id === id)?.name ?? id;

// Source windows keyed by subject, in the shape the release builder reads.
export const SOURCE_WINDOWS = Object.fromEntries(CONFIG.subjects.map((s) => [s.id, s.windows]));

// Publication host -> publication, for naming captured documents.
export const PUBLICATIONS = new Map(CONFIG.subjects.flatMap((s) => s.publications.flatMap((p) => [new URL(p.origin).hostname, ...p.aliases].map((h) => [h, { ...p, subject: s.id }] as const))));
