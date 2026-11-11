// One structured call per provider, with no tools: the model sees only the
// prompt and returns an object matching a schema. Anthropic is called through
// its SDK; OpenAI through its Responses API. Both are API-key routes only: a
// subscription CLI runs an agent with a shell, which a reviewer must not have
// (cross-vendor audit, 2026-10-28). Every call passes through a Budget that
// enforces positive limits on calls, tokens, time, and estimated spend, and
// refuses to run a model whose price it does not know.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import YAML from "yaml";
import { z } from "zod";
import type { Provider } from "../../src/policy.ts";
import { callClaudeCli, callCodexCli, CLI_MODELS } from "./subscription.ts";

export type Usage = { input_tokens: number; output_tokens: number; cached_input_tokens: number | null; reasoning_tokens: number | null };
export type CallResult<T> =
  | { ok: true; output: T; model: string; usage: Usage | null; cost_usd: string | null; startedAt: string; completedAt: string; raw: unknown }
  | { ok: false; status: "error" | "malformed" | "timeout" | "unavailable" | "budget"; error: string; model: string; usage: Usage | null; cost_usd: string | null; startedAt: string; completedAt: string; raw: unknown };

export const MODELS: Record<Provider, string> = {
  anthropic: process.env.PC_ANTHROPIC_MODEL || "claude-opus-5-5",
  openai: process.env.PC_OPENAI_MODEL || "gpt-6-astra",
};

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

type Price = { input: string; output: string; long_context_input?: string; long_context_threshold_tokens?: number };
const PRICES: Record<string, Price> = fs.existsSync("ops/prices.yaml") ? YAML.parse(fs.readFileSync("ops/prices.yaml", "utf8")) : {};

export function priceOf(model: string, usage: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const inRate = p.long_context_threshold_tokens && usage.input_tokens > p.long_context_threshold_tokens && p.long_context_input ? Number(p.long_context_input) : Number(p.input);
  return (usage.input_tokens * inRate + usage.output_tokens * Number(p.output)) / 1_000_000;
}

// Positive, finite limits for one run. Splitting work into child runs does not
// reset them: a run passes the same Budget to everything it starts.
export type Limits = { maxCalls: number; maxInputTokens: number; maxOutputTokens: number; maxSeconds: number; spendCeilingUsd: number };
export class Budget {
  calls = 0; inputTokens = 0; outputTokens = 0; spendUsd = 0; unknownCost = false;
  readonly started = Date.now();
  readonly limits: Limits;
  constructor(limits: Limits) {
    this.limits = limits;
    for (const [k, v] of Object.entries(limits)) if (!(Number.isFinite(v) && v > 0)) throw new Error(`budget limit ${k} must be a positive number, got ${v}`);
  }
  // Called before each request with a worst-case estimate.
  admit(model: string, estInputTokens: number, maxOutputTokens: number): string | null {
    if (this.calls + 1 > this.limits.maxCalls) return `call limit ${this.limits.maxCalls} reached`;
    if (this.inputTokens + estInputTokens > this.limits.maxInputTokens) return `input token limit ${this.limits.maxInputTokens} would be exceeded`;
    if (this.outputTokens + maxOutputTokens > this.limits.maxOutputTokens) return `output token limit ${this.limits.maxOutputTokens} would be exceeded`;
    if ((Date.now() - this.started) / 1000 > this.limits.maxSeconds) return `time limit ${this.limits.maxSeconds}s reached`;
    const worst = priceOf(model, { input_tokens: estInputTokens, output_tokens: maxOutputTokens, cached_input_tokens: null, reasoning_tokens: null });
    if (worst === null) return `no price is known for ${model}; a spend ceiling cannot be enforced`;
    if (this.unknownCost) return "an earlier call's cost is unknown; stopping rather than guess";
    if (this.spendUsd + worst > this.limits.spendCeilingUsd) return `spend ceiling $${this.limits.spendCeilingUsd} would be exceeded (worst case $${(this.spendUsd + worst).toFixed(4)})`;
    this.calls++;
    return null;
  }
  // Subscription calls have no per-call price: limit calls and time, count tokens when known.
  admitCall(): string | null {
    if (this.calls + 1 > this.limits.maxCalls) return `call limit ${this.limits.maxCalls} reached`;
    if ((Date.now() - this.started) / 1000 > this.limits.maxSeconds) return `time limit ${this.limits.maxSeconds}s reached`;
    this.calls++;
    return null;
  }
  recordTokens(usage: Usage | null) { if (usage) { this.inputTokens += usage.input_tokens; this.outputTokens += usage.output_tokens; } }
  record(model: string, usage: Usage | null): string | null {
    if (!usage) { this.unknownCost = true; return null; }
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    const c = priceOf(model, usage);
    if (c === null) { this.unknownCost = true; return null; }
    this.spendUsd += c;
    return c.toFixed(6);
  }
  report() {
    return { calls: this.calls, input_tokens: this.inputTokens, output_tokens: this.outputTokens, estimated_spend_usd: this.unknownCost ? null : this.spendUsd.toFixed(4), seconds: Math.round((Date.now() - this.started) / 1000), limits: this.limits };
  }
}

// A rough pre-call size: about four characters per token, rounded up.
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5) + 200;

const SECRET_SHAPES = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bsk-ant-[A-Za-z0-9_-]{10,}/, /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\bghp_[A-Za-z0-9]{20,}/, /\bAKIA[A-Z0-9]{12,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
export function looksLikeSecret(v: unknown): boolean { const s = JSON.stringify(v); return SECRET_SHAPES.some((re) => re.test(s)); }

// JSON Schema for a provider's strict structured output: drop the length and
// pattern keywords providers reject. zod still validates the answer afterwards.
export function providerSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const strip = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(strip);
    if (n && typeof n === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) if (!["maxLength", "minLength", "pattern", "format", "$schema", "maxItems", "minItems"].includes(k)) o[k] = strip(v);
      if (o.type === "object" && o.properties) { o.required = Object.keys(o.properties as object); o.additionalProperties = false; }
      return o;
    }
    return n;
  };
  return strip(js) as Record<string, unknown>;
}

export type Request<T> = { system: string; user: string; schema: z.ZodType<T>; schemaName: string; maxOutputTokens?: number; timeoutMs?: number };

export type Route = "api" | "subscription";

export async function call<T>(provider: Provider, req: Request<T>, budget: Budget, route: Route = "api"): Promise<CallResult<T>> {
  if (route === "subscription") {
    const refused = budget.admitCall();
    if (refused) return { ok: false, status: "budget", error: refused, model: CLI_MODELS[provider], usage: null, cost_usd: null, startedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), completedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), raw: null };
    const r = provider === "anthropic" ? await callClaudeCli(req) : await callCodexCli(req);
    budget.recordTokens(r.usage);
    return r;
  }
  const model = MODELS[provider];
  const startedAt = stamp();
  const maxOut = req.maxOutputTokens ?? 16000;
  const fail = (status: Exclude<CallResult<T>, { ok: true }>["status"], error: string, usage: Usage | null = null, raw: unknown = null, cost: string | null = null): CallResult<T> =>
    ({ ok: false, status, error: error.slice(0, 600), model, usage, cost_usd: cost, startedAt, completedAt: stamp(), raw });
  const key = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) return fail("unavailable", `no ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}; the review cannot run`);
  const refused = budget.admit(model, estimateTokens(req.system + req.user), maxOut);
  if (refused) return fail("budget", refused);
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: key, timeout: req.timeoutMs ?? 600_000, maxRetries: 2 });
      // Thinking is set explicitly (adaptive is the only mode Opus 5.5 accepts)
      // and effort is set explicitly (its default is medium).
      const r = await client.messages.parse({
        model, max_tokens: maxOut, system: req.system, messages: [{ role: "user", content: req.user }],
        thinking: { type: "adaptive" }, output_config: { effort: "high", format: zodOutputFormat(req.schema as z.ZodType<T> & z.ZodObject) },
      } as Parameters<typeof client.messages.parse>[0]);
      const usage: Usage = { input_tokens: (r.usage.input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), output_tokens: r.usage.output_tokens ?? 0, cached_input_tokens: r.usage.cache_read_input_tokens ?? null, reasoning_tokens: null };
      const cost = budget.record(r.model, usage);
      if (r.stop_reason === "refusal") return fail("error", `the model declined (${(r as { stop_details?: { category?: string } }).stop_details?.category ?? "no category"})`, usage, r, cost);
      if (r.stop_reason === "max_tokens") return fail("malformed", "the answer was cut off at the output limit", usage, r, cost);
      const parsed = (r as { parsed_output?: unknown }).parsed_output;
      const v = req.schema.safeParse(parsed);
      if (!v.success) return fail("malformed", `the answer did not match the schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, usage, r, cost);
      if (looksLikeSecret(v.data)) return fail("malformed", "the answer carries something shaped like a credential", usage, null, cost);
      return { ok: true, output: v.data, model: r.model, usage, cost_usd: cost, startedAt, completedAt: stamp(), raw: r };
    }
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, instructions: req.system, input: req.user, reasoning: { effort: "high" }, max_output_tokens: maxOut, store: false,
        text: { format: { type: "json_schema", name: req.schemaName, schema: providerSchema(req.schema), strict: true } },
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 600_000),
    });
    const body = (await resp.json()) as any;
    if (!resp.ok) return fail(resp.status === 408 ? "timeout" : "error", `OpenAI ${resp.status}: ${JSON.stringify(body?.error ?? body).slice(0, 300)}`);
    const u = body.usage;
    const usage: Usage | null = u ? { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cached_input_tokens: u.input_tokens_details?.cached_tokens ?? null, reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? null } : null;
    const cost = budget.record(body.model ?? model, usage);
    if (body.status === "incomplete") return fail("malformed", `the answer was incomplete (${body.incomplete_details?.reason ?? "no reason"})`, usage, body, cost);
    const msg = (body.output ?? []).find((o: any) => o.type === "message");
    const refusal = msg?.content?.find((c: any) => c.type === "refusal");
    if (refusal) return fail("error", `the model declined: ${String(refusal.refusal).slice(0, 200)}`, usage, body, cost);
    const text = msg?.content?.find((c: any) => c.type === "output_text")?.text;
    if (typeof text !== "string") return fail("malformed", "no output text", usage, body, cost);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return fail("malformed", "the output text is not JSON", usage, body, cost); }
    const v = req.schema.safeParse(parsed);
    if (!v.success) return fail("malformed", `the answer did not match the schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, usage, body, cost);
    if (looksLikeSecret(v.data)) return fail("malformed", "the answer carries something shaped like a credential", usage, null, cost);
    return { ok: true, output: v.data, model: body.model ?? model, usage, cost_usd: cost, startedAt, completedAt: stamp(), raw: body };
  } catch (err) {
    const e = err as Error;
    return fail(/timeout|aborted/i.test(e.name + e.message) ? "timeout" : "error", e.message);
  }
}
