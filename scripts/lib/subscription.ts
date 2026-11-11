// Review calls through the owner's subscriptions instead of the paid APIs
// (owner decision, 2026-10-28, for the initial full-corpus build). Each call
// runs the provider's command-line client with every tool switched off, from
// an empty working directory, with nothing of the owner's setup loaded:
// - Claude: `claude -p` in safe mode (no CLAUDE.md, memory, skills, plugins,
//   hooks, or MCP servers), `--tools ""` (no tools at all), no session saved.
// - Codex: `codex exec` with the shell and every other tool feature disabled,
//   a read-only sandbox as a second fence, user config and rules ignored, and
//   nothing persisted.
// scripts/probe-subscription.ts proves both fences before any real use; the
// review records say `via: cli-login` so the method page can say which route
// produced each review. Output is validated and refused if it carries
// anything shaped like a credential.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { looksLikeSecret, providerSchema, type CallResult, type Usage } from "./vendors.ts";

export const CLI_MODELS = {
  anthropic: process.env.PC_CLAUDE_CLI_MODEL || "claude-opus-5-5",
  openai: process.env.PC_CODEX_MODEL || "gpt-6-astra",
} as const;

const CLAUDE = process.env.CLAUDE_BIN || "/opt/homebrew/bin/claude";
const CODEX = process.env.CODEX_BIN || "/opt/homebrew/bin/codex";
const CLAUDE_CONFIG_DIR = process.env.PC_CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude-personal");
const CODEX_HOME = process.env.PC_CODEX_HOME || path.join(os.homedir(), ".codex-personal");

// Every Codex feature that gives the model a way to act. Disabling them
// leaves a model that can only read the prompt and write the answer.
export const CODEX_DISABLED_FEATURES = [
  "shell_tool", "unified_exec", "unified_exec_tty", "shell_snapshot", "apps", "browser_use", "browser_use_external",
  "browser_use_full_cdp_access", "computer_use", "image_generation", "multi_agent", "plugins", "remote_plugin", "hooks",
  "view_image", "tool_suggest", "skill_search", "skill_mcp_dependency_install", "sleep_tool", "in_app_browser",
  "in_app_local_automation", "goals", "workspace_dependencies", "code_mode_host", "code_mode_interrupt",
];

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// Once a provider reports a usage limit, every later call to it in this
// process returns "unavailable" at once instead of spawning a client, so a run
// stops cleanly and can resume after the limit resets.
const LIMIT = /usage limit|rate limit|limit reached|hit your [\w -]*limit|too many requests|quota/i;
export const tripped: Record<"anthropic" | "openai", string | null> = { anthropic: null, openai: null };
// Each limit is also logged with its time and account, so the morning email
// can say when a subscription ran out (scripts/digest.ts).
function trip(provider: "anthropic" | "openai", msg: string): void {
  tripped[provider] = msg;
  const account = provider === "anthropic" ? path.basename(CLAUDE_CONFIG_DIR) : path.basename(CODEX_HOME);
  try { fs.mkdirSync(".runs", { recursive: true }); fs.appendFileSync(".runs/limits.jsonl", JSON.stringify({ at: stamp(), provider, account, script: path.basename(process.argv[1] ?? ""), message: msg }) + "\n"); } catch { /* logging must never stop a run */ }
}
const trippedResult = <T>(provider: "anthropic" | "openai", model: string): CallResult<T> => ({ ok: false, status: "unavailable", error: `usage limit reached earlier in this run: ${tripped[provider]}`.slice(0, 600), model, usage: null, cost_usd: null, startedAt: stamp(), completedAt: stamp(), raw: null });

function run(cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; stdin: string; timeoutMs: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Standard output goes to a file, not a pipe: the Claude CLI exits before a
    // pipe drains, and every answer past its first 8 KB was lost.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-out-"));
    const outFile = path.join(outDir, "stdout");
    const fd = fs.openSync(outFile, "w");
    const cleanup = () => fs.rmSync(outDir, { recursive: true, force: true });
    let p: ReturnType<typeof spawn>;
    try { p = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["pipe", fd, "pipe"] }); } finally { fs.closeSync(fd); }
    let stderr = "";
    const cap = 4 * 1024 * 1024;
    const timer = setTimeout(() => { p.kill("SIGKILL"); cleanup(); reject(new Error(`${path.basename(cmd)} timed out after ${Math.round(o.timeoutMs / 1000)}s`)); }, o.timeoutMs);
    p.stderr!.on("data", (d) => { if (stderr.length < cap) stderr += d; });
    p.on("error", (e) => { clearTimeout(timer); cleanup(); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      let stdout = "";
      try { stdout = fs.readFileSync(outFile, "utf8").slice(0, cap); } catch { /* removed after a timeout */ }
      cleanup();
      resolve({ code, stdout, stderr });
    });
    p.stdin!.end(o.stdin);
  });
}

// Only what the client needs: no API keys (an Anthropic key in the
// environment would silently bill the API instead), no project paths.
function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  // USER and LOGNAME let the client find its saved login in the macOS keychain.
  const user = os.userInfo().username;
  // The clients are Node programs: their own directories and this Node's come
  // first, so a CI runner (no /opt/homebrew) finds them too.
  const dirs = [...new Set([path.dirname(CLAUDE), path.dirname(CODEX), path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])];
  return { PATH: dirs.join(":"), HOME: os.homedir(), USER: user, LOGNAME: user, TMPDIR: os.tmpdir(), LANG: "en_US.UTF-8", TERM: "dumb", ...extra };
}

// CI has no saved login: Claude reads Dave's personal subscription token
// (CLAUDE_CODE_OAUTH_TOKEN, a subscription login, never an API key). Only
// the Claude client gets it.
function claudeLogin(): Record<string, string> {
  return process.env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN } : { CLAUDE_CONFIG_DIR };
}

type Req<T> = { system: string; user: string; schema: z.ZodType<T>; schemaName: string; timeoutMs?: number; model?: string; effort?: "low" | "medium" | "high" | "xhigh" };
// Research calls (the evidence drafter) may use named built-in tools and MCP
// servers, and take more turns. Every other call has no tools at all.
// Error text is written to public logs (research/corpus/*-log.jsonl): keep the
// words, drop anything shaped like a session, thread or request identifier.
export const publicError = (s: string): string => s
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
  .replace(/((?:thread|session|request|conversation|response|turn)_id\\?"\s*:\s*\\?")[^"\\]+/g, "$1<id>")
  .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "<redacted>");

type Tools = { builtin: string[]; mcp: Record<string, { command: string; args: string[]; env: Record<string, string> }>; allowed: string[]; maxTurns: number };

export async function callClaudeCli<T>(req: Req<T>, tools?: Tools): Promise<CallResult<T>> {
  const model = req.model ?? CLI_MODELS.anthropic;
  if (tripped.anthropic) return trippedResult("anthropic", model);
  const startedAt = stamp();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pc-claude-"));
  const fail = (status: "error" | "malformed" | "timeout", error: string, usage: Usage | null = null, raw: unknown = null): CallResult<T> => ({ ok: false, status, error: publicError(error).slice(0, 600), model, usage, cost_usd: null, startedAt, completedAt: stamp(), raw });
  try {
    const args = [
      // Safe mode also turns off MCP servers, so research calls rely on the
      // other switches: no setting sources (no CLAUDE.md, memory, hooks, or
      // plugins), only the MCP servers named here, and only the allowed tools.
      // scripts/probe-subscription.ts checks that nothing of the owner's leaks.
      "-p", ...(tools ? [] : ["--safe-mode"]), "--tools", (tools?.builtin ?? []).join(","), "--no-session-persistence", "--disable-slash-commands", "--no-chrome",
      "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: tools?.mcp ?? {} }), "--setting-sources", "",
      ...(tools ? ["--allowedTools", tools.allowed.join(",")] : []),
      "--model", model, "--effort", req.effort ?? "high", "--max-turns", String(tools?.maxTurns ?? 3), "--output-format", "json",
      "--json-schema", JSON.stringify(providerSchema(req.schema)), "--system-prompt", req.system,
    ];
    const r = await run(CLAUDE, args, { cwd, env: baseEnv(claudeLogin()), stdin: req.user, timeoutMs: req.timeoutMs ?? 900_000 });
    const line = r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    if (!line) {
      const tail = (r.stderr || r.stdout).trim().slice(-300);
      if (LIMIT.test(tail)) { trip("anthropic", tail.slice(-200)); return trippedResult("anthropic", model); }
      return fail("error", `claude exited ${r.code} without JSON: ${tail}`);
    }
    let body;
    // Keep what came back, so an answer that cannot be read can be recovered, not bought again.
    try { body = JSON.parse(line); } catch { return fail("malformed", "claude's output is not JSON", null, r.stdout.slice(-400_000)); }
    const u = body.usage ?? {};
    const usage: Usage | null = u.output_tokens != null ? { input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens, cached_input_tokens: u.cache_read_input_tokens ?? null, reasoning_tokens: null } : null;
    const returned = Object.keys(body.modelUsage ?? {})[0] ?? model;
    if (body.is_error) {
      const msg = String(body.result ?? body.errors ?? "");
      if (LIMIT.test(msg)) { trip("anthropic", msg.slice(0, 200)); return trippedResult("anthropic", model); }
      return fail("error", `claude reported an error: ${msg.slice(0, 300)}`, usage, body);
    }
    const output = body.structured_output ?? (typeof body.result === "string" ? (() => { try { return JSON.parse(body.result); } catch { return null; } })() : null);
    const v = req.schema.safeParse(output);
    if (!v.success) return fail("malformed", `the answer did not match the schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, usage, body);
    if (looksLikeSecret(v.data)) return fail("malformed", "the answer carries something shaped like a credential", usage);
    return { ok: true, output: v.data, model: returned, usage, cost_usd: null, startedAt, completedAt: stamp(), raw: body };
  } catch (err) {
    const e = err as Error;
    return fail(/timed out/.test(e.message) ? "timeout" : "error", e.message);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// Research calls on Codex: live web search and the named MCP servers, each
// pre-approved. Codex calls tools through its code-mode host, so that stays on;
// the shell and every other way to act stay off, and the event check below
// refuses any item that is not a message, reasoning, a web search, or a call
// to a named server.
export type CodexTools = { mcp: Record<string, { command: string; args: string[]; env: Record<string, string> }> };

export async function callCodexCli<T>(req: Req<T>, tools?: CodexTools): Promise<CallResult<T>> {
  const model = CLI_MODELS.openai;
  if (tripped.openai) return trippedResult("openai", model);
  const startedAt = stamp();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "pc-codex-"));
  const cwd = path.join(work, "empty");
  fs.mkdirSync(cwd);
  const schemaFile = path.join(work, "schema.json");
  const outFile = path.join(work, "out.json");
  fs.writeFileSync(schemaFile, JSON.stringify(providerSchema(req.schema)));
  const fail = (status: "error" | "malformed" | "timeout", error: string, raw: unknown = null): CallResult<T> => ({ ok: false, status, error: publicError(error).slice(0, 600), model, usage: null, cost_usd: null, startedAt, completedAt: stamp(), raw });
  try {
    const args = [
      "exec", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--sandbox", "read-only", "-C", cwd,
      ...CODEX_DISABLED_FEATURES.filter((f) => !tools || !f.startsWith("code_mode")).flatMap((f) => ["--disable", f]),
      "-c", tools ? 'web_search="live"' : 'web_search="disabled"',
      ...Object.entries(tools?.mcp ?? {}).flatMap(([name, m]) => [
        "-c", `mcp_servers.${name}.command=${JSON.stringify(m.command)}`, "-c", `mcp_servers.${name}.args=${JSON.stringify(m.args)}`,
        "-c", `mcp_servers.${name}.env={${Object.entries(m.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",")}}`,
        "-c", `mcp_servers.${name}.default_tools_approval_mode="approve"`,
      ]),
      "-m", model, "-c", `model_reasoning_effort="${req.effort ?? "high"}"`, "--output-schema", schemaFile, "-o", outFile, "--json",
    ];
    const prompt = `${req.system}\n\nAnswer with one JSON object matching the output schema and nothing else.\n\n${req.user}`;
    const r = await run(CODEX, args, { cwd, env: baseEnv({ CODEX_HOME }), stdin: prompt, timeoutMs: req.timeoutMs ?? 900_000 });
    const log = r.stdout + "\n" + r.stderr;
    // The event stream lists every item the run produced. Anything other than
    // the model's own message and reasoning means a tool ran: refuse.
    const events = r.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as { type: string; item?: { type?: string; server?: string }; usage?: Record<string, number> }[];
    // "error" items are notices, for example that a disabled tool will fail closed.
    const allowedItem = (i: { type?: string; server?: string }) => ["agent_message", "reasoning", "error"].includes(i.type!)
      || (!!tools && (i.type === "web_search" || (i.type === "mcp_tool_call" && !!i.server && i.server in tools.mcp)));
    const acted = events.filter((e) => e.item?.type && !allowedItem(e.item));
    if (acted.length) return fail("error", `codex used a tool (${[...new Set(acted.map((e) => e.item!.type))].join(", ")}); answer refused`, log.slice(-2000));
    const turn = events.filter((e) => e.type === "turn.completed").at(-1)?.usage;
    if (!fs.existsSync(outFile)) {
      if (LIMIT.test(log.slice(-3000))) { trip("openai", log.trim().slice(-200)); return trippedResult("openai", model); }
      return fail("error", `codex exited ${r.code} without an answer: ${log.trim().slice(-300)}`);
    }
    const text = fs.readFileSync(outFile, "utf8").trim();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return fail("malformed", "the answer is not JSON", text.slice(0, 400_000)); }
    const v = req.schema.safeParse(parsed);
    if (!v.success) return fail("malformed", `the answer did not match the schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    if (looksLikeSecret(v.data)) return fail("malformed", "the answer carries something shaped like a credential");
    const usage: Usage | null = turn ? { input_tokens: turn.input_tokens ?? 0, output_tokens: turn.output_tokens ?? 0, cached_input_tokens: turn.cached_input_tokens ?? null, reasoning_tokens: turn.reasoning_output_tokens ?? null } : null;
    return { ok: true, output: v.data, model, usage, cost_usd: null, startedAt, completedAt: stamp(), raw: log.slice(-4000) };
  } catch (err) {
    const e = err as Error;
    return fail(/timed out/.test(e.message) ? "timeout" : "error", e.message);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
