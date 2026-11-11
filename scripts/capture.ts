// node scripts/capture.ts <url> [--archive YYYYMMDD] [--dry-run]
// Captures one source: public metadata, an immutable version, a fetch event;
// the full text goes to private storage only.
import { captureUrl } from "./lib/capture.ts";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("https://"));
if (!url) { console.error("usage: node scripts/capture.ts <https-url> [--archive YYYYMMDD] [--dry-run]"); process.exit(2); }
const at = args.indexOf("--archive");
const r = await captureUrl(url, { archiveAt: at >= 0 ? args[at + 1] : undefined, dryRun: args.includes("--dry-run") });
const { text, ...rest } = r;
console.log(JSON.stringify({ ...rest, chars: text?.length ?? 0, head: text?.slice(0, 240) ?? null }, null, 1));
