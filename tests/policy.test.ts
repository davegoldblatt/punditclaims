// The three copies of the policy (src/policy.ts for code, policy/policy.yaml
// for validation and readers of the data, docs/policy.md for people) say the
// same thing, and every regression in fixtures/regressions.yaml points at a
// test that exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";
import * as P from "../src/policy.ts";
import { z } from "zod";
import { CONFIG, RegisterConfig } from "../src/config.ts";
import { Subject } from "../src/schema.ts";

test("the configuration is the only place a deployment names its people", () => {
  assert.ok(RegisterConfig.safeParse(CONFIG).success);
  // Another deployment: one person, one publication. The schema accepts it.
  const other = { ...CONFIG, subjects: [{ id: "jane-doe", name: "Jane Doe", publications: [{ name: "Doe Weekly", origin: "https://doe.example.org", platform: "generic", prefix: "doe", aliases: [] }], windows: [{ id: "doe-all", publication: "Doe Weekly", origin: "https://doe.example.org", from: "2024-01-01", to: "2026-01-01", basis: "Every post.", discover: true }] }] };
  assert.ok(RegisterConfig.safeParse(other).success);
  assert.equal(RegisterConfig.safeParse({ ...other, subjects: [...other.subjects, other.subjects[0]] }).success, false, "subject ids are unique");
  // No code outside the configuration names this deployment's people.
  const offenders: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|astro|mjs)$/.test(p) && /Gary Marcus|Ed Zitron|gary-marcus|ed-zitron|wheresyoured|garymarcus/.test(fs.readFileSync(p, "utf8"))) offenders.push(p); } };
  for (const d of ["src", "scripts"]) walk(d);
  assert.deepEqual(offenders, [], "code is generic; the people live in config/register.yaml");
});

test("the starter files for a new register are valid and agree with each other", () => {
  const reg = RegisterConfig.parse(YAML.parse(fs.readFileSync("config/register.example.yaml", "utf8")));
  // The subject id is an enum of this deployment's people, so check the example's shape with any slug.
  const subj = Subject.extend({ id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).parse(YAML.parse(fs.readFileSync("config/subject.example.yaml", "utf8")));
  const person = reg.subjects.find((s) => s.id === subj.id);
  assert.ok(person, "the subject example is a person in the register example");
  assert.equal(subj.name, person.name);
  const windows = new Set(person.windows.map((w) => w.id));
  for (const w of subj.collection_windows) assert.ok(windows.has(w), `window ${w} is in the register example`);
  for (const w of person.windows) assert.ok(person.publications.some((p) => p.name === w.publication && p.origin === w.origin), `window ${w.id} names one of its publications`);
  // The tests and preview builds never read the deployment's own configuration.
  assert.match(process.env.PC_CONFIG ?? "", /fixtures\/register\.yaml$/, "npm test sets PC_CONFIG to fixtures/register.yaml");
});

const policy = YAML.parse(fs.readFileSync("policy/policy.yaml", "utf8"));

test("policy.yaml matches the code's vocabulary and version", () => {
  assert.equal(policy.version, P.POLICY_VERSION);
  assert.equal(policy.schema_version, P.SCHEMA_VERSION);
  assert.deepEqual(P.SUBJECT_IDS, CONFIG.subjects.map((s) => s.id), "subjects come from the configuration");
  const v = policy.vocabulary;
  assert.deepEqual(v.claim_kinds, [...P.CLAIM_KINDS]);
  assert.deepEqual(v.axes, [...P.AXES]);
  assert.deepEqual(v.outcomes, [...P.OUTCOMES]);
  assert.deepEqual(v.horizon_states, [...P.HORIZON_STATES]);
  assert.deepEqual(v.workflow_states, [...P.WORKFLOW_STATES]);
  assert.deepEqual(v.held_reasons, [...P.HELD_REASONS]);
  assert.deepEqual(v.access_states, [...P.ACCESS_STATES]);
  assert.deepEqual(v.endorsements, [...P.ENDORSEMENTS]);
  assert.deepEqual(v.evidence_relations, [...P.EVIDENCE_RELATIONS]);
  assert.deepEqual(v.invalidation_reasons, [...P.INVALIDATION_REASONS]);
  assert.deepEqual(v.providers, [...P.PROVIDERS]);
  for (const [kind, axes] of Object.entries(policy.rules.axes_for_kind)) assert.deepEqual(axes, [...P.AXES_FOR_KIND[kind as P.ClaimKind]], kind);
  assert.deepEqual(policy.targets, { ...P.COLLECTION_TARGET });
});

test("docs/policy.md states the current version and every outcome label", () => {
  const md = fs.readFileSync("docs/policy.md", "utf8");
  assert.ok(md.includes(P.POLICY_VERSION), "docs/policy.md names the policy version");
  for (const o of P.OUTCOMES) assert.ok(md.includes(`\`${o}\``), `docs/policy.md defines ${o}`);
  for (const h of P.HELD_REASONS) assert.ok(md.includes(`\`${h}\``), `docs/policy.md defines ${h}`);
});

test("every covered regression names a test that exists", () => {
  const list = YAML.parse(fs.readFileSync("fixtures/regressions.yaml", "utf8")) as { id: string; covered_by: string | null; ticket: string }[];
  assert.equal(new Set(list.map((r) => r.id)).size, list.length, "regression ids are unique");
  for (const r of list) {
    if (!r.covered_by) { assert.match(r.ticket, /^DAV-\d+$/, `${r.id} names the ticket that owns it`); continue; }
    const [file, name] = r.covered_by.split("#");
    assert.ok(fs.existsSync(file), `${r.id}: ${file} exists`);
    assert.ok(fs.readFileSync(file, "utf8").includes(`test("${name}"`), `${r.id}: ${file} has a test named ${name}`);
  }
});
