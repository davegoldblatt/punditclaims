// A one-tool MCP server (stdio, JSON-RPC) for the evidence drafter. The
// drafter finds pages with web search and reads them only through this tool,
// which captures each page with the safe fetcher (scripts/lib/capture.ts) and
// returns the captured text. So every quotation the drafter copies comes from
// the exact text that ingest later verifies against, and every page it read
// is recorded. A page already captured in full is served from the store.
import readline from "node:readline";

process.chdir(process.env.PC_ROOT ?? process.cwd());
const { captureUrl, documentIdFor } = await import("./lib/capture.ts");
const fs = await import("node:fs");
const { getSnapshot } = await import("./lib/private-store.ts");
const { FULL_ACCESS } = await import("../src/policy.ts");

const MAX_CHARS = Number(process.env.PC_READ_MAX_CHARS ?? 60000);
const TOOL = {
  name: "read_page",
  description: "Read a web page as plain text. Use this for every page you cite: quotations must be copied character for character from the text it returns. Optional 'find' returns only the passages around each match, for long pages.",
  inputSchema: { type: "object", properties: { url: { type: "string", description: "An https URL" }, find: { type: "string", description: "Optional word or phrase; returns the text around each match" } }, required: ["url"] },
};

const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");

async function readPage(url: string, find?: string): Promise<string> {
  if (!/^https:\/\//.test(url)) return "Only https URLs can be read.";
  let id: string;
  try { id = documentIdFor(url); } catch { return "That is not a valid URL."; }
  const dir = `data/sources/${id}/versions`;
  const versions = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f: string) => f.endsWith(".json")).map((f: string) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"))) : [];
  const have = versions.filter((v: { access_state: string }) => FULL_ACCESS.has(v.access_state as never)).sort((a: { first_observed_at: string }, b: { first_observed_at: string }) => (a.first_observed_at < b.first_observed_at ? 1 : -1))[0];
  let text = have ? getSnapshot(have.snapshot_hash) : null;
  let access = have?.access_state ?? null;
  if (!text) {
    const c = await captureUrl(url);
    if (!c.text) return `Could not read ${url}: ${c.error ?? c.access_state}.`;
    text = c.text; access = c.access_state;
  }
  const head = FULL_ACCESS.has(access as never) ? `FULL TEXT of ${url}` : `PARTIAL TEXT (${access}) of ${url}: only a preview could be read, so it cannot be cited as evidence`;
  if (find) {
    const out: string[] = [];
    const lower = text.toLowerCase(), q = find.toLowerCase();
    for (let i = lower.indexOf(q); i >= 0 && out.length < 12; i = lower.indexOf(q, i + q.length)) out.push(`[at ${i}] …${text.slice(Math.max(0, i - 700), i + q.length + 700)}…`);
    return `${head}\n${out.length ? out.join("\n\n") : `No match for "${find}".`}`;
  }
  return `${head}\n${text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[truncated at ${MAX_CHARS} of ${text.length} characters; call again with 'find' to read further]` : text}`;
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let m: { id?: number | string; method?: string; params?: { name?: string; arguments?: { url?: string; find?: string }; protocolVersion?: string } };
  try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pages", version: "1.0.0" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [TOOL] } });
  else if (m.method === "tools/call") {
    const a = m.params?.arguments ?? {};
    let text: string;
    try { text = m.params?.name === "read_page" && a.url ? await readPage(a.url, a.find) : "Unknown tool or missing url."; } catch (e) { text = `Error: ${(e as Error).message}`; }
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text }] } });
  } else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
