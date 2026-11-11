// npm run validate: every record against its schema, every cross-file
// reference, every recomputed hash, the policy file against the code, and the
// subjects' collection windows against the policy. Exit 1 on any problem.
import fs from "node:fs";
import YAML from "yaml";
import { loadStore } from "../src/lib/data.ts";
import { POLICY_VERSION, SUBJECT_IDS } from "../src/policy.ts";
import { SOURCE_WINDOWS } from "../src/config.ts";

const policy = YAML.parse(fs.readFileSync("policy/policy.yaml", "utf8"));
const s = loadStore("data");
const problems = [...s.problems];
if (policy.version !== POLICY_VERSION) problems.push({ file: "policy/policy.yaml", message: `version ${policy.version} is not the code's ${POLICY_VERSION}` });
for (const id of SUBJECT_IDS) {
  const subj = s.subjects.get(id);
  const windows = new Set((SOURCE_WINDOWS[id] ?? []).map((w) => w.id));
  for (const w of subj?.collection_windows ?? []) if (!windows.has(w)) problems.push({ file: `data/subjects/${id}.yaml`, message: `collection window ${w} is not in config/register.yaml` });
}
for (const [cid, vs] of s.contracts) for (const k of vs) if (k.policy_version !== POLICY_VERSION && !policy.changes.some((c: { version: string }) => c.version === k.policy_version)) {
  problems.push({ file: `data/contracts/${cid}/${k.version}.yaml`, message: `unknown policy version ${k.policy_version}` });
}
const counts = [
  ["subjects", s.subjects.size], ["documents", s.documents.size], ["source versions", s.versions.size], ["occurrences", s.occurrences.size],
  ["claims", s.claims.size], ["contracts", s.contracts.size], ["evidence packets", s.packets.size], ["review runs", s.reviews.size],
  ["assessments", s.assessments.size], ["events", s.events.size],
];
console.log(counts.map(([k, n]) => `${n} ${k}`).join(" · "));
for (const p of problems) console.log(`ERROR ${p.file}: ${p.message}`);
console.log(problems.length ? `${problems.length} problem(s)` : "valid");
process.exit(problems.length ? 1 : 0);
