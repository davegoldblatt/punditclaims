// The rule fixtures. Each test is named after its entry in
// fixtures/regressions.yaml, and each pairs a case that must fail with the
// corrected case that must pass, so a rule that collapses to "always fail" or
// "always pass" is caught by its own control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCase, item } from "../fixtures/lib/case.ts";
import { checkCase, RULES, suggestTopics, type RuleName } from "../src/lib/rules.ts";
import { ClaimRevision } from "../src/schema.ts";

const fails = (c: ReturnType<typeof buildCase>, rule: RuleName) => assert.ok(RULES[rule](c).length > 0, `expected ${rule} to fail`);
const passes = (c: ReturnType<typeof buildCase>) => assert.deepEqual(checkCase(c), [], "expected every rule to hold");

test("baseline fixture passes every rule", () => passes(buildCase()));

test("robust-bust", () => {
  const topics = { bubble: ["bubble", "bust", "crash"], regulation: ["regulation", "enforcement"] };
  const text = "Governments should require robust enforcement of AI regulation before deployment.";
  assert.deepEqual(suggestTopics(text, topics), ["regulation"]);
  assert.deepEqual(suggestTopics("The bubble will bust within a year.", topics), ["bubble"]);
  // The recommendation itself is normative: it cannot be put on a forecast axis.
  const asForecast = buildCase({ claim: { kind: "normative", modality: "should", normalized_proposition: "Governments should require robust enforcement." } });
  fails(asForecast, "kindAndAxis");
  passes(buildCase({
    claim: { kind: "normative", modality: "should", original_horizon_text: null },
    contract: { assessment_axis: "not_applicable", horizon_interval: null, original_horizon: null, ambiguity_flags: ["recommendation"] },
    packet: { evidence_items: [] },
    assessment: { axis: "not_applicable", outcome: "not_adjudicable", horizon_state: "not_applicable" },
  }));
});

test("historical-pause", () => {
  const observation = {
    claim: { kind: "observation" as const, modality: "is" as const, original_horizon_text: null, normalized_proposition: "Work on fixture model 5 is paused (September 2023)." },
    contract: { assessment_axis: "historical_observation" as const, horizon_interval: null, original_horizon: null, target_period: { start: "2023-09", end: "2023-09", precision: "month" as const } },
    assessment: { axis: "historical_observation" as const, horizon_state: "not_applicable" as const },
  };
  const laterRelease = item({ id: "fx-release", event_date: "2025-08-07", available_at: "2025-08-07" });
  // A date that only overlaps the period is not precise enough: "2023" for September 2023.
  fails(buildCase({ ...observation, packet: { evidence_items: [item({ id: "fx-vague", event_date: "2023", available_at: "2023-12-31" })] }, assessment: { ...observation.assessment, outcome: "supported" } }), "observationWindow");
  fails(buildCase({ ...observation, packet: { evidence_items: [{ ...laterRelease, relation: "contradicts" }] }, assessment: { ...observation.assessment, outcome: "contradicted" } }), "observationWindow");
  // Corrected: evidence about September 2023 decides; the release is context.
  passes(buildCase({
    ...observation,
    packet: { evidence_items: [item({ id: "fx-pause", event_date: "2023-09-14", available_at: "2023-09-14", relation: "supports" }), { ...laterRelease, relation: "context" }] },
    assessment: { ...observation.assessment, outcome: "supported" },
  }));
});

test("conditional-disappointment", () => {
  const conditional = {
    kind: "conditional_forecast" as const, modality: "may" as const, original_horizon_text: null,
    normalized_proposition: "If fixture model 5 disappoints, fixture-lab valuations may suffer.",
    conditions: [{ text: "fixture model 5 disappoints", type: "antecedent" as const, from_source: true }],
  };
  // The schema refuses a conditional without its antecedent.
  assert.equal(ClaimRevision.safeParse({ ...buildCase().claim, ...conditional, conditions: [] }).success, false);
  const base = { claim: conditional, contract: { horizon_interval: null, original_horizon: null, condition_status: "not_met" as const } };
  fails(buildCase({ ...base, packet: { evidence_items: [item({ id: "fx-x", relation: "contradicts" })] }, assessment: { outcome: "contradicted", horizon_state: "conclusive_event" } }), "conditional");
  passes(buildCase({ ...base, contract: { ...base.contract, ambiguity_flags: ["antecedent did not occur"] }, packet: { evidence_items: [] }, assessment: { outcome: "not_adjudicable", horizon_state: "open_horizon" } }));
  // Unknown antecedent: no verdict.
  const unknownBase = { claim: { ...conditional, modality: "will" as const }, contract: { horizon_interval: null, original_horizon: null, condition_status: "unknown" as const, early_resolution_rule: "x" } };
  const scoredEarly = { outcome: "contradicted" as const, horizon_state: "conclusive_event" as const, conclusive_event: { evidence_id: "fx-x", event_date: "2025-06-01", meets_rule: "x" } };
  fails(buildCase({ ...unknownBase, packet: { evidence_items: [item({ id: "fx-x", relation: "contradicts" })] }, assessment: scoredEarly }), "conditional");
  // Met, but not shown: no verdict. Met and shown: may be scored.
  const met = { ...unknownBase, contract: { ...unknownBase.contract, condition_status: "met" as const } };
  fails(buildCase({ ...met, packet: { evidence_items: [item({ id: "fx-x", relation: "contradicts" })] }, assessment: scoredEarly }), "conditional");
  passes(buildCase({ ...met, packet: { evidence_items: [item({ id: "fx-x", relation: "contradicts" }), item({ id: "fx-cond", role: "evidence_of_condition", relation: "supports" })] }, assessment: scoredEarly }));
  // A conditional must say whether its antecedent happened.
  fails(buildCase({ claim: conditional, contract: { horizon_interval: null, original_horizon: null, condition_status: "not_applicable" }, assessment: { outcome: "unresolved", horizon_state: "open_horizon" } }), "conditional");
});

test("normative-deadline", () => {
  const should = { kind: "normative" as const, modality: "should" as const, normalized_proposition: "Fixture labs should publish audits by December." };
  fails(buildCase({ claim: should }), "kindAndAxis");
  fails(buildCase({ claim: should, contract: { assessment_axis: "not_applicable", horizon_interval: null, original_horizon: null }, assessment: { axis: "not_applicable", outcome: "contradicted", horizon_state: "not_applicable" } }), "kindAndAxis");
});

const scope = (over = {}) => ({
  company: "Fixture Labs", metric: "operating_expenses", currency: "USD", units: "billions", accounting_basis: "company_reported" as const,
  fiscal_or_calendar: "calendar" as const, period_start: "2025-01-01", period_end: "2025-12-31", stock_or_flow: "flow" as const,
  annualized_or_realized: "realized" as const, gross_or_net: "not_applicable" as const, ...over,
});

test("financial-period", () => {
  const fin = { contract: { metric_scope: scope() } };
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-q1", relation: "contradicts", metric_scope: scope({ period_start: "2026-01-01", period_end: "2026-03-31" }) })] }, assessment: { outcome: "contradicted" } }), "financialScope");
  passes(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-fy", relation: "supports", metric_scope: scope() }), item({ id: "fx-q1", relation: "context", metric_scope: scope({ period_start: "2026-01-01", period_end: "2026-03-31" }) })] } }));
});

test("financial-units-and-currency", () => {
  const fin = { contract: { metric_scope: scope({ metric: "revenue" }) } };
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue", currency: "EUR" }) })] } }), "financialScope");
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue", units: "millions" }) })] } }), "financialScope");
  // A quarter inside the year is not the year.
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue", period_start: "2025-01-01", period_end: "2025-03-31" }) })] } }), "financialScope");
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue", accounting_basis: "unknown" }) })] } }), "financialScope");
  fails(buildCase({ contract: { metric_scope: scope({ metric: "revenue", accounting_basis: "unknown" }) }, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue", accounting_basis: "unknown" }) })] } }), "financialScope");
});

test("financial-metric", () => {
  const fin = { contract: { metric_scope: scope({ metric: "revenue" }) } };
  for (const metric of ["financing_raised", "cash", "operating_income", "net_income", "annualized_run_rate", "valuation"]) {
    fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric }) })] } }), "financialScope");
  }
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue", annualized_or_realized: "annualized" }) })] } }), "financialScope");
  fails(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: null })] } }), "financialScope");
  passes(buildCase({ ...fin, packet: { evidence_items: [item({ id: "fx-m", relation: "supports", metric_scope: scope({ metric: "revenue" }) })] } }));
});

test("future-horizon", () => {
  const future = { contract: { horizon_interval: { start: null, end: "2027-12-31", precision: "day" as const }, original_horizon: "by the end of 2027" }, claim: { original_horizon_text: "by the end of 2027" } };
  // Absence before the deadline is not failure.
  fails(buildCase({ ...future, packet: { evidence_items: [item({ id: "fx-none", relation: "contradicts" })] }, assessment: { outcome: "contradicted", horizon_state: "not_due" } }), "horizon");
  fails(buildCase({ ...future, assessment: { outcome: "unresolved", horizon_state: "elapsed" } }), "horizon");
  passes(buildCase({ ...future, packet: { evidence_items: [] }, assessment: { outcome: "unresolved", horizon_state: "not_due" } }));
  // Settled early only through a conclusive event the contract allows.
  const early = { ...future, packet: { evidence_items: [item({ id: "fx-ship", relation: "contradicts", event_date: "2026-05-01", available_at: "2026-05-01" })] }, assessment: { outcome: "contradicted" as const, horizon_state: "conclusive_event" as const } };
  fails(buildCase(early), "horizon");
  const rule = { ...future.contract, early_resolution_rule: "A general release before the deadline settles the forecast early." };
  // A rule and a label are not enough: the event itself must be named and bound.
  fails(buildCase({ ...early, contract: rule }), "horizon");
  fails(buildCase({ ...early, contract: rule, assessment: { ...early.assessment, conclusive_event: { evidence_id: "fx-ship", event_date: "2026-04-01", meets_rule: "A general release." } } }), "horizon");
  fails(buildCase({ ...early, contract: rule, assessment: { ...early.assessment, conclusive_event: { evidence_id: "fx-nope", event_date: "2026-05-01", meets_rule: "A general release." } } }), "horizon");
  passes(buildCase({ ...early, contract: rule, assessment: { ...early.assessment, conclusive_event: { evidence_id: "fx-ship", event_date: "2026-05-01", meets_rule: "A general release on 2026-05-01, before the 2027 deadline." } } }));
});

test("hindsight", () => {
  const march = { packet: { evaluation_as_of: "2026-03-02" } };
  fails(buildCase({ ...march, packet: { ...march.packet, evidence_items: [item({ id: "fx-june", event_date: "2025-12-31", available_at: "2026-06-10" })] } }), "hindsight");
  fails(buildCase({ ...march, packet: { ...march.packet, evidence_items: [item({ id: "fx-month", event_date: "2025-12-31", available_at: "2026-03" })] } }), "hindsight");
  passes(buildCase({ ...march, packet: { ...march.packet, evidence_items: [item({ id: "fx-jan", event_date: "2025-12-31", available_at: "2026-01-05" })] } }));
});

test("plain-reading", () => {
  const plain = { contract: { interpretation_determines_result: true, plain_reading: true, evaluator_interpretation: ["We read 'begin to burst' as a fall of at least 20% in the major AI companies' market value within the window."] } };
  // Scored, and the page must say so.
  fails(buildCase(plain), "interpretation");
  passes(buildCase({ ...plain, assessment: { public_payload: { plain_reading: true } as any } }));
  // Never for hedged language, and never without a stated reading.
  fails(buildCase({ ...plain, claim: { modality: "likely" }, assessment: { public_payload: { plain_reading: true } as any } }), "interpretation");
  fails(buildCase({ contract: { ...plain.contract, evaluator_interpretation: [] }, assessment: { public_payload: { plain_reading: true } as any } }), "interpretation");
});

test("interpretation-determines", () => {
  fails(buildCase({ contract: { interpretation_determines_result: true } }), "interpretation");
  passes(buildCase({ contract: { interpretation_determines_result: true }, packet: { unresolved_gaps: ["No agreed threshold for 'reliable'."] }, assessment: { outcome: "unresolved" } }));
});

test("prospective-label", () => {
  const pro = { retrospective_or_prospective: "prospective" as const, outcome_known_at_freeze: false, frozen_at: "2025-11-01T00:00:00Z", written_at: "2025-11-01T00:00:00Z" };
  // Evidence already public at the freeze.
  fails(buildCase({ contract: { ...pro, frozen_at: "2026-02-01T00:00:00Z", written_at: "2026-02-01T00:00:00Z" } }), "prospective");
  // The drafter declares the outcome was known.
  fails(buildCase({ contract: { ...pro, outcome_known_at_freeze: true } }), "prospective");
  // An empty packet does not make a past observation prospective.
  fails(buildCase({
    claim: { kind: "observation", modality: "is", original_horizon_text: null },
    contract: { ...pro, assessment_axis: "historical_observation", horizon_interval: null, original_horizon: null, target_period: { start: "2023-09", end: "2023-09", precision: "month" } },
    packet: { evidence_items: [], unresolved_gaps: ["none found"] },
    assessment: { axis: "historical_observation", horizon_state: "not_applicable", outcome: "unresolved" },
  }), "prospective");
  passes(buildCase({ contract: pro }));
});

test("statement-is-not-proof", () => {
  const self = item({ id: "fx-self", role: "evidence_of_statement", source_type: "author_statement", relation: "supports" });
  fails(buildCase({ packet: { evidence_items: [self] } }), "evidenceForOutcome");
  fails(buildCase({ packet: { evidence_items: [{ ...self, role: "evidence_of_outcome" }] } }), "evidenceForOutcome");
  passes(buildCase({ packet: { evidence_items: [self, item({ id: "fx-ev-1" })] } }));
});

test("hedged-modality", () => {
  for (const modality of ["may", "could", "likely", "unlikely"] as const) fails(buildCase({ claim: { modality } }), "modality");
  passes(buildCase({ claim: { modality: "likely" }, contract: { ambiguity_flags: ["probabilistic language"] }, assessment: { outcome: "not_adjudicable" } }));
  passes(buildCase({ claim: { modality: "will_not" } }));
});

test("evidence must back the outcome it is used for", () => {
  fails(buildCase({ packet: { evidence_items: [item({ id: "fx-c", relation: "context" })] } }), "evidenceForOutcome");
  fails(buildCase({ assessment: { outcome: "mixed" } }), "evidenceForOutcome");
  fails(buildCase({ packet: { evidence_items: [], unresolved_gaps: [] }, assessment: { outcome: "unresolved" } }), "evidenceForOutcome");
});

test("references bind every layer by hash", () => {
  const c = buildCase();
  const other = buildCase({ claim: { normalized_proposition: "A different proposition." } });
  fails({ ...c, contract: other.contract }, "references");
  fails({ ...c, packet: { ...c.packet, material_counterevidence: ["fx-missing"] } }, "references");
  const counter = buildCase({ packet: { evidence_items: [item({ id: "fx-ev-1" }), item({ id: "fx-against", relation: "contradicts" })], material_counterevidence: ["fx-against"] }, assessment: { counterevidence_ids: [] , evidence_ids: ["fx-ev-1"] } });
  fails(counter, "references");
});

test("quoting cap per source", async () => {
  const { quotedShare } = await import("../src/lib/rules.ts");
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  assert.deepEqual(quotedShare(new Map([["doc", { excerpts: [words(40), words(40)], documentWords: 2000 }]]), 150, 0.1), [], "the same excerpt twice counts once");
  assert.equal(quotedShare(new Map([["doc", { excerpts: [words(40), "a " + words(39), "b " + words(39), "c " + words(39)], documentWords: 5000 }]]), 150, 0.1).length, 1);
  assert.equal(quotedShare(new Map([["doc", { excerpts: [words(40)], documentWords: 300 }]]), 150, 0.1).length, 1, "over 10% of a short post");
});
