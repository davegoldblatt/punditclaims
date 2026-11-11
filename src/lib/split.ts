// Predictions vs. claims about the present or past (docs/plans/predictions-vs-claims.md).
// Readers hear "were they right?" as "did their predictions come true?", but
// most settled claims are about how things were or are. This splits one
// person's record into the two groups, per confidence level, with the same
// rules as the answer: settled claims at strict; at reasonable and speculative,
// probable calls (docs/adr/0006) from live and held claims are added as right
// or wrong, exactly as the answer's lighter squares are.
import type { HeldRecord, PublicClaim } from "./manifest.ts";
import type { ClaimKind } from "../policy.ts";

export type Group = "prediction" | "present";
export type Level = "strict" | "reasonable" | "speculative";
export const GROUPS: Group[] = ["prediction", "present"];
export const LEVELS: Level[] = ["strict", "reasonable", "speculative"];

// Recommendations, value judgments, and rhetoric fall in neither group: they
// are never settled, so they never enter an answer.
export const GROUP_OF: Record<ClaimKind, Group | null> = {
  forecast: "prediction", conditional_forecast: "prediction",
  observation: "present", causal: "present",
  normative: null, rhetoric: null,
};

// open: live unresolved claims without a probable call counted at this level.
// probable: the probable calls (live and held) counted as right or wrong.
export type GroupCounts = { supported: number; mixed: number; contradicted: number; open: number; probable: number };

// A probable call counts at a level when the level includes its own level.
const counts = (callLevel: string, level: Level): boolean => level === "speculative" || (level === "reasonable" && callLevel === "reasonable");

export function splitCounts(live: PublicClaim[], held: HeldRecord[], group: Group, level: Level): GroupCounts {
  const out: GroupCounts = { supported: 0, mixed: 0, contradicted: 0, open: 0, probable: 0 };
  for (const c of live) {
    if (GROUP_OF[c.kind] !== group || !c.current) continue;
    const o = c.current.payload.outcome;
    if (o === "supported" || o === "mixed" || o === "contradicted") { out[o]++; continue; }
    if (o !== "unresolved") continue;
    if (c.probable && counts(c.probable.level, level)) { out[c.probable.call === "probably_right" ? "supported" : "contradicted"]++; out.probable++; }
    else out.open++;
  }
  for (const h of held) {
    if (!h.kind || GROUP_OF[h.kind] !== group || !h.probable || !counts(h.probable.level, level)) continue;
    out[h.probable.call === "probably_right" ? "supported" : "contradicted"]++;
    out.probable++;
  }
  return out;
}

export type Split3 = { supported: number; mixed: number; contradicted: number };
export const settledTotal = (x: Split3): number => x.supported + x.mixed + x.contradicted;

// Whole percentages that add up to 100 (largest remainder): the rule the
// answer's three big percentages use, so a split line never disagrees with them.
export function pcts(x: Split3): Split3 {
  const n = settledTotal(x);
  if (!n) return { supported: 0, mixed: 0, contradicted: 0 };
  const keys = ["supported", "mixed", "contradicted"] as const;
  const raw = keys.map((k) => (100 * x[k]) / n);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  for (const i of raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).map((p) => p[1])) if (left-- > 0) out[i]++;
  return { supported: out[0], mixed: out[1], contradicted: out[2] };
}
