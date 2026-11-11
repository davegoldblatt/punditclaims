// Probable calls (docs/adr/0006). The strict review settles a claim only when
// two providers agree under its frozen criteria, so it leaves many claims
// unresolved or held that a reasonable reader would still call. Both providers
// answer that looser question on the same frozen case, and both answers must
// be bound to the case as it stands now. The same call from both is a
// reasonable call. A call from one, with "too early" from the other, is a
// speculative call. A probable call never changes an assessment, never
// enters the answer in words, and is always shown apart from the settled claims.
import type { Store } from "./data.ts";
import { contractByHash } from "./data.ts";
import { caseDigest } from "./binding.ts";
import { isScreenContract } from "./screen.ts";
import type { GateResult } from "./gate.ts";
import { POLICY_VERSION, type Provider } from "../policy.ts";
import type { Assessment, BatchProbableOutput, BatchReviewOutput, EvidencePacket, ReviewRun } from "../schema.ts";

export type ProbableCall = "probably_right" | "probably_wrong";
export const PROBABLE_LABEL: Record<ProbableCall, string> = { probably_right: "Probably right", probably_wrong: "Probably wrong" };
// Reasonable: both providers made the same call. Speculative: one made a call
// and the other answered "too early". A right-against-wrong split is no call.
export type ProbableLevel = "reasonable" | "speculative";
// reasons: the one-line reason of each provider whose answer is the call
// (both at reasonable, one at speculative), Anthropic first.
export type Probable = { call: ProbableCall; level: ProbableLevel; reasons?: { provider: Provider; reason: string }[] };

// Held for a doubt about the words or the reading itself: no call on those.
const DOUBTED = new Set(["attribution_uncertain", "quote_mismatch", "source_partial", "source_unavailable"]);

// Each claim's newest evidence packet, by claim id (the same pick as the review's frozen case).
const packetCache = new WeakMap<Store, Map<string, EvidencePacket>>();
function latestPackets(s: Store): Map<string, EvidencePacket> {
  let m = packetCache.get(s);
  if (!m) {
    m = new Map();
    for (const p of s.packets.values()) { const id = p.claim_revision_ref.id; const q = m.get(id); if (!q || q.packet_id < p.packet_id) m.set(id, p); }
    packetCache.set(s, m);
  }
  return m;
}

// Which claims may get a probable call: a published claim the strict review
// left unresolved, or a held claim that was graded against evidence and whose
// words and reading are not in doubt.
export function probableEligible(s: Store, a: Assessment, g: GateResult): boolean {
  const id = a.claim_revision_ref.id;
  const contract = contractByHash(s, id, a.contract_ref.content_hash);
  if (!contract || isScreenContract(contract)) return false;
  // Only the case as it stands: the latest claim revision, contract, and packet.
  const latestPacket = latestPackets(s).get(id);
  if (s.claims.get(id)?.at(-1)?.content_hash !== a.claim_revision_ref.content_hash || s.contracts.get(id)?.at(-1)?.content_hash !== contract.content_hash || latestPacket?.packet_hash !== a.packet_ref.content_hash) return false;
  if (g.result === "published") return a.outcome === "unresolved";
  if (DOUBTED.has(g.reason) || g.reason === "stale_binding") return false;
  // A failed final-text check is about our wording; any other reading split is about the claim.
  if (g.reason === "semantic_disagreement" && !g.detail.startsWith("The final-text check failed")) return false;
  // The gate stops at its first failure, so look at every bound strict review:
  // a doubt about attribution or the reading rules the claim out.
  for (const r of a.reviewer_run_ids) {
    const run = s.reviews.get(r);
    if (run?.status !== "ok" || run.kind !== "batch_review") continue;
    for (const x of (run.output as BatchReviewOutput).reviews.filter((y) => y.claim_id === id)) {
      if (!x.attribution.speaker_is_subject || !x.attribution.endorsed || !x.semantics.proposition_faithful) return false;
    }
  }
  return true;
}

// Every probable-call run, by the claims it answered. Build once per store.
export function probableIndex(s: Store): Map<string, ReviewRun[]> {
  const out = new Map<string, ReviewRun[]>();
  for (const r of s.reviews.values()) {
    if (r.kind !== "batch_probable" || r.status !== "ok") continue;
    for (const k of Object.keys(r.input_hashes)) if (k.startsWith("case:")) { const id = k.slice(5); out.set(id, [...(out.get(id) ?? []), r]); }
  }
  return out;
}

// The call on this assessment's case, or null. Each provider's newest answer
// bound to the case counts, and both providers must have answered.
export function probableCall(s: Store, a: Assessment, index: Map<string, ReviewRun[]>): Probable | null {
  const id = a.claim_revision_ref.id;
  const runs = index.get(id);
  if (!runs?.length) return null;
  const claim = s.claims.get(id)?.at(-1);
  const contract = contractByHash(s, id, a.contract_ref.content_hash);
  const packet = s.packets.get(a.packet_ref.id);
  if (!claim || !contract || !packet || claim.content_hash !== a.claim_revision_ref.content_hash) return null;
  const digests = new Map<string, string>();
  const newest = new Map<Provider, { at: string; call: string; reason: string }>();
  for (const r of runs) {
    if (!digests.has(r.prompt_hash)) digests.set(r.prompt_hash, caseDigest(s, claim, contract, packet, POLICY_VERSION, r.prompt_hash));
    if (r.input_hashes[`case:${id}`] !== digests.get(r.prompt_hash)) continue;
    const mine = (r.output as BatchProbableOutput).calls.filter((c) => c.claim_id === id);
    if (mine.length !== 1) continue;
    const at = r.completed_at ?? r.started_at;
    const prev = newest.get(r.provider);
    if (!prev || prev.at < at) newest.set(r.provider, { at, call: mine[0].call, reason: mine[0].reason });
  }
  const x = newest.get("anthropic")?.call, y = newest.get("openai")?.call;
  if (!x || !y) return null;
  const why = (call: string) => (["anthropic", "openai"] as Provider[]).filter((p) => newest.get(p)!.call === call).map((p) => ({ provider: p, reason: newest.get(p)!.reason }));
  if (x === y) return x === "too_early" ? null : { call: x as ProbableCall, level: "reasonable", reasons: why(x) };
  if (x === "too_early" || y === "too_early") { const call = (x === "too_early" ? y : x) as ProbableCall; return { call, level: "speculative", reasons: why(call) }; }
  return null;
}
