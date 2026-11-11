// node scripts/roll-windows.ts [--to YYYY-MM-DD]
// The daily update's first step: every window marked `rolling: true` in
// config/register.yaml now ends on the run date, and retrieval_cutoff moves
// with it, so new posts are discovered and new claims are checked against
// evidence up to that day. Existing claims keep the date they were first
// checked against (scripts/lib/evaluation.ts). Comments and layout in the
// file are kept. Never moves a date backwards.
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

const argv = process.argv.slice(2);
const at = argv.indexOf("--to");
const to = at >= 0 ? argv[at + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { console.error(`bad date ${to}`); process.exit(2); }
const file = path.resolve(process.env.PC_CONFIG ?? "config/register.yaml");
// Read with the YAML parser, write by changing only the date lines, so the
// file's layout and comments stay exactly as they were.
let text = fs.readFileSync(file, "utf8");
const doc = parseDocument(text);
let moved = 0;
const subjects = doc.get("subjects") as any;
for (const subj of subjects.items) {
  for (const w of subj.get("windows").items) {
    if (w.get("rolling") !== true) continue;
    const id = String(w.get("id"));
    if (w.get("evaluate_as_of")) { console.error(`${id}: a rolling window cannot pin evaluate_as_of`); process.exit(2); }
    const was = String(w.get("to"));
    if (to <= was) continue;
    const head = text.indexOf(`- id: ${id}\n`);
    const next = text.indexOf("- id: ", head + 6);
    const block = text.slice(head, next < 0 ? undefined : next);
    const line = `to: "${was}"`;
    if (head < 0 || block.split(line).length !== 2) { console.error(`${id}: cannot find its one "to" line`); process.exit(2); }
    text = text.slice(0, head) + block.replace(line, `to: "${to}"`) + (next < 0 ? "" : text.slice(next));
    moved++; console.log(`${id}: ${was} -> ${to}`);
  }
}
const cut = String(doc.get("retrieval_cutoff"));
if (to > cut) {
  const line = `retrieval_cutoff: "${cut}"`;
  if (text.split(line).length !== 2) { console.error("cannot find the one retrieval_cutoff line"); process.exit(2); }
  text = text.replace(line, `retrieval_cutoff: "${to}"`);
  console.log(`retrieval_cutoff: ${cut} -> ${to}`);
}
fs.writeFileSync(file, text);
parseDocument(text); // still parses
console.log(moved ? `${moved} window(s) rolled to ${to}` : `nothing to roll (already at ${to} or later)`);
