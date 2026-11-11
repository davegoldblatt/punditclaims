// The editorial rules that code can check, as one pure function per concern.
// Each returns a list of problems in plain words; an empty list means the rule
// holds. The gate refuses to publish an assessment with any problem here, and
// tests/rules.test.ts pairs every rule with a case that must fail and a
// corrected case that must pass. These checks do not judge whether a claim is
// true. They stop a judgment from being recorded in a shape the policy forbids.
import { AXES_FOR_KIND, HEDGED_MODALITIES } from "../policy.ts";
import type { Assessment, ClaimRevision, EvidenceItem, EvidencePacket, FinancialScope, ResolutionContract } from "../schema.ts";
import { dayOf, earliestDay, latestDay } from "./dates.ts";

export type Case = { claim: ClaimRevision; contract: ResolutionContract; packet: EvidencePacket; assessment: Assessment };

const SCORED = new Set(["supported", "contradicted", "mixed"]);
const dayish = (d: string) => (d.length > 10 ? dayOf(d) : d);
// Items that can decide an outcome: outcome evidence that supports or contradicts.
// A statement, the author's own assertion, or context never decides one.
export const outcomeItems = (items: EvidenceItem[]) => items.filter((i) => i.role === "evidence_of_outcome" && i.relation !== "context" && i.source_type !== "author_statement");

export function kindAndAxis({ claim, contract, assessment }: Case): string[] {
  const out: string[] = [];
  if (!AXES_FOR_KIND[claim.kind].includes(contract.assessment_axis)) out.push(`a ${claim.kind} claim cannot be assessed on the ${contract.assessment_axis} axis`);
  if (assessment.axis !== contract.assessment_axis) out.push("the assessment uses a different axis from its contract");
  if (assessment.axis === "not_applicable" && assessment.outcome !== "not_adjudicable") out.push("an ungraded axis records not_adjudicable");
  return out;
}

// Where a forecast stands on the evaluation date, from the contract alone.
export function expectedHorizon(contract: ResolutionContract, asOf: string): "open_horizon" | "not_due" | "elapsed" | "not_applicable" {
  if (contract.assessment_axis !== "forecast_outcome") return "not_applicable";
  const end = contract.horizon_interval?.end;
  if (!end) return "open_horizon";
  return latestDay(end) < latestDay(asOf) ? "elapsed" : "not_due";
}

export function horizon({ contract, packet, assessment }: Case): string[] {
  const out: string[] = [];
  const ce = assessment.conclusive_event;
  if (assessment.axis !== "forecast_outcome") {
    if (ce) out.push("only a forecast can be settled by a conclusive event");
    return out;
  }
  const expected = expectedHorizon(contract, assessment.evaluation_as_of);
  const h = assessment.horizon_state;
  if (h === "conclusive_event") {
    if (!contract.early_resolution_rule) out.push("settling a forecast before its deadline needs an early-resolution rule in the contract");
    if (!ce) out.push("a conclusive event names the evidence item that is the event");
    else {
      const item = packet.evidence_items.find((i) => i.id === ce.evidence_id);
      if (!item || !outcomeItems([item]).length) out.push(`the conclusive event ${ce.evidence_id} is not outcome evidence in the packet`);
      else {
        if (item.event_date !== ce.event_date) out.push("the conclusive event's date differs from its evidence");
        if (!assessment.evidence_ids.includes(item.id)) out.push("the conclusive event is not among the assessment's evidence");
        if (latestDay(ce.event_date) > latestDay(assessment.evaluation_as_of)) out.push("the conclusive event is after the evidence cutoff");
        const end = contract.horizon_interval?.end;
        if (end && latestDay(ce.event_date) > latestDay(end)) out.push("an event after the deadline is not an early resolution");
      }
    }
  } else {
    if (ce) out.push("a conclusive event is recorded but the horizon does not say so");
    if (h !== expected) out.push(`the horizon on ${assessment.evaluation_as_of} is ${expected}, not ${h}`);
  }
  if (SCORED.has(assessment.outcome) && h !== "elapsed" && h !== "conclusive_event") out.push(`a forecast is scored only after its deadline or a conclusive event; it is ${h}`);
  return out;
}

// A conditional is scored only when its antecedent demonstrably happened.
export function conditional({ claim, contract, packet, assessment }: Case): string[] {
  const out: string[] = [];
  if (claim.kind !== "conditional_forecast") {
    if (contract.condition_status !== "not_applicable") out.push("only a conditional forecast records a condition status");
    return out;
  }
  if (contract.condition_status === "not_applicable") out.push("a conditional forecast records whether its antecedent happened");
  if (SCORED.has(assessment.outcome)) {
    if (contract.condition_status !== "met") out.push(`the antecedent is ${contract.condition_status}, so the conditional is neither confirmed nor falsified`);
    const shown = packet.evidence_items.filter((i) => i.role === "evidence_of_condition" && i.relation === "supports" && assessment.evidence_ids.includes(i.id));
    if (!shown.length) out.push("scoring a conditional needs evidence that its antecedent happened");
  }
  return out;
}

// Hedged and probabilistic forecasts are recorded and shown with what
// happened, but a single outcome does not score them.
export function modality({ claim, assessment }: Case): string[] {
  if ((claim.kind === "forecast" || claim.kind === "conditional_forecast") && HEDGED_MODALITIES.has(claim.modality) && SCORED.has(assessment.outcome)) {
    return [`"${claim.modality}" is hedged or probabilistic; one outcome does not score it`];
  }
  return [];
}

// When our reading decides the result, the claim is scored only on a stated
// plain reading (policy .6), and only for firm language. Otherwise not.
export function interpretation({ claim, contract, assessment }: Case): string[] {
  const out: string[] = [];
  if (contract.plain_reading) {
    if (!contract.evaluator_interpretation.length) out.push("a plain reading must be stated in our interpretation");
    if (HEDGED_MODALITIES.has(claim.modality)) out.push("hedged language is not scored, even on a plain reading");
    if (assessment.public_payload.plain_reading !== true) out.push("a record scored on a plain reading must say so on the page");
    return out;
  }
  if (contract.interpretation_determines_result && SCORED.has(assessment.outcome)) {
    out.push("the result turns on our interpretation rather than the speaker's words, so it cannot be scored without a stated plain reading");
  }
  return out;
}

// An observation is judged on the period it describes, and the evidence must
// be dated precisely enough to fall inside that period, not merely overlap it.
export function observationWindow({ contract, packet, assessment }: Case): string[] {
  if (assessment.axis !== "historical_observation" || !contract.target_period) return [];
  const p = contract.target_period;
  const lo = p.start ? earliestDay(p.start) : "0000-01-01";
  const hi = p.end ? latestDay(p.end) : "9999-12-31";
  return outcomeItems(packet.evidence_items)
    .filter((i) => earliestDay(i.event_date) < lo || latestDay(i.event_date) > hi)
    .map((i) => `${i.id} is dated ${i.event_date}, which is not inside the period described (${p.start ?? "…"} to ${p.end ?? "…"}); it can only be context`);
}

const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
function scopeDiff(a: FinancialScope, b: FinancialScope): string | null {
  for (const k of ["company", "metric", "currency", "units", "stock_or_flow", "annualized_or_realized", "gross_or_net", "fiscal_or_calendar", "accounting_basis"] as const) {
    if (!same(a[k], b[k])) return `${k} ${b[k] ?? "unstated"} is not ${a[k] ?? "unstated"}`;
  }
  const aLo = a.period_start ? earliestDay(a.period_start) : null, aHi = a.period_end ? latestDay(a.period_end) : null;
  const bLo = b.period_start ? earliestDay(b.period_start) : null, bHi = b.period_end ? latestDay(b.period_end) : null;
  if (aLo !== bLo || aHi !== bHi) return `period ${b.period_start ?? "?"}..${b.period_end ?? "?"} is not ${a.period_start ?? "?"}..${a.period_end ?? "?"}`;
  return null;
}

// Revenue is not run rate, operating income is not net income, cash is not
// cash flow, financing is not revenue, dollars are not euros, millions are not
// billions, and a quarter is not a year. Decisive evidence measures exactly
// the contract's quantity, or derives it with stated inputs and formula.
export function financialScope({ contract, packet, assessment }: Case): string[] {
  const scope = contract.metric_scope;
  const out: string[] = [];
  for (const i of outcomeItems(packet.evidence_items)) {
    if (!scope) continue;
    if (!i.metric_scope) { out.push(`${i.id} is decisive for a financial claim but states no metric scope`); continue; }
    const diff = scopeDiff(scope, i.metric_scope);
    if (diff) out.push(`${i.id} measures something else (${diff}); it can only be context unless it is derived with stated inputs`);
    if (i.derived && (!i.derived.inputs.length || !i.derived.formula.trim())) out.push(`${i.id} is derived but lists no inputs or formula`);
  }
  if (scope && scope.accounting_basis === "unknown" && SCORED.has(assessment.outcome)) out.push("the contract's accounting basis is unknown; a financial claim is scored only on a stated basis");
  return out;
}

// A packet cannot use what was not yet public at its cutoff.
export function hindsight({ packet }: Case): string[] {
  const cutoff = latestDay(packet.evaluation_as_of);
  return packet.evidence_items
    .filter((i) => latestDay(dayish(i.available_at)) > cutoff)
    .map((i) => `${i.id} was not available by ${packet.evaluation_as_of} (available ${i.available_at})`);
}

// Prospective means the criteria froze before anyone could know the outcome:
// a forecast, frozen before its deadline, with the outcome not yet public,
// and every decisive item published after the freeze.
export function prospective({ contract, packet }: Case): string[] {
  if (contract.retrospective_or_prospective !== "prospective") return [];
  const out: string[] = [];
  const frozen = dayOf(contract.frozen_at);
  if (contract.assessment_axis !== "forecast_outcome") out.push("only a forecast can be recorded prospectively");
  if (contract.outcome_known_at_freeze) out.push("the outcome was known when the contract froze");
  const end = contract.horizon_interval?.end;
  if (end && frozen > latestDay(end)) out.push("the contract froze after the deadline");
  for (const i of outcomeItems(packet.evidence_items)) {
    if (earliestDay(dayish(i.available_at)) <= frozen) out.push(`${i.id} was public by ${i.available_at}, before the contract froze on ${frozen}`);
  }
  return out;
}

export function evidenceForOutcome({ contract, packet, assessment }: Case): string[] {
  const out: string[] = [];
  const used = outcomeItems(packet.evidence_items.filter((i) => assessment.evidence_ids.includes(i.id)));
  const sup = used.filter((i) => i.relation === "supports").length;
  const con = used.filter((i) => i.relation === "contradicts").length;
  switch (assessment.outcome) {
    case "supported": if (!sup) out.push("supported needs at least one supporting item of outcome evidence"); break;
    case "contradicted": if (!con) out.push("contradicted needs at least one contradicting item of outcome evidence"); break;
    case "mixed": if (!sup || !con) out.push("mixed needs a supporting and a contradicting item of outcome evidence"); break;
    case "unresolved":
      if (assessment.axis !== "not_applicable" && assessment.horizon_state !== "not_due" && (!packet.search_record.queries.length || !packet.unresolved_gaps.length)) {
        out.push("unresolved needs a search record and a stated gap");
      }
      break;
    case "not_adjudicable":
      if (assessment.axis !== "not_applicable" && !contract.ambiguity_flags.length && !contract.interpretation_determines_result) {
        out.push("an empirical claim is not adjudicable only with a stated ambiguity");
      }
      break;
  }
  return out;
}

export function references({ claim, contract, packet, assessment }: Case): string[] {
  const out: string[] = [];
  const ids = new Set(packet.evidence_items.map((i) => i.id));
  if (contract.claim_revision_ref.content_hash !== claim.content_hash) out.push("the contract was written for a different revision of the claim");
  if (packet.contract_ref.content_hash !== contract.content_hash) out.push("the evidence packet was assembled for a different contract");
  if (packet.claim_revision_ref.content_hash !== claim.content_hash) out.push("the evidence packet was assembled for a different revision of the claim");
  if (assessment.contract_ref.content_hash !== contract.content_hash) out.push("the assessment cites a different contract");
  if (assessment.claim_revision_ref.content_hash !== claim.content_hash) out.push("the assessment cites a different revision of the claim");
  if (assessment.packet_ref.content_hash !== packet.packet_hash) out.push("the assessment cites a different evidence packet");
  if (assessment.evaluation_as_of !== packet.evaluation_as_of) out.push("the assessment and its packet have different evidence cutoffs");
  for (const id of [...assessment.evidence_ids, ...assessment.counterevidence_ids, ...packet.material_counterevidence]) if (!ids.has(id)) out.push(`${id} is not in the evidence packet`);
  for (const id of packet.material_counterevidence) if (!assessment.counterevidence_ids.includes(id)) out.push(`material counterevidence ${id} is not shown with the assessment`);
  if (ids.size !== packet.evidence_items.length) out.push("evidence item ids repeat");
  return out;
}

export const RULES = { kindAndAxis, horizon, conditional, modality, interpretation, observationWindow, financialScope, hindsight, prospective, evidenceForOutcome, references } as const;
export type RuleName = keyof typeof RULES;

export function checkCase(c: Case): { rule: RuleName; problem: string }[] {
  const out: { rule: RuleName; problem: string }[] = [];
  for (const [name, fn] of Object.entries(RULES) as [RuleName, (c: Case) => string[]][]) for (const problem of fn(c)) out.push({ rule: name, problem });
  return out;
}

// Quoting limits across a whole release: the words taken from one source
// document, over every occurrence excerpt and evidence receipt, stay under
// both the absolute cap and the share of the document.
export function quotedShare(byDocument: Map<string, { excerpts: string[]; documentWords: number }>, maxWords: number, maxShare: number): string[] {
  const out: string[] = [];
  for (const [doc, { excerpts, documentWords }] of byDocument) {
    const n = [...new Set(excerpts)].reduce((t, e) => t + e.trim().split(/\s+/).filter(Boolean).length, 0);
    if (n > maxWords) out.push(`${doc}: ${n} words quoted, over the ${maxWords}-word cap per source`);
    else if (documentWords > 0 && n / documentWords > maxShare) out.push(`${doc}: ${n} of ${documentWords} words quoted, over ${Math.round(maxShare * 100)}% of the source`);
  }
  return out;
}

// Topic suggestions match whole words, never substrings: "robust" is not "bust".
export function suggestTopics(text: string, topics: Record<string, readonly string[]>): string[] {
  const tokens = new Set((text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? []));
  const lower = text.toLowerCase();
  return Object.entries(topics).filter(([, kws]) => kws.some((k) => (k.includes(" ") ? new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u").test(lower) : tokens.has(k)))).map(([t]) => t);
}
