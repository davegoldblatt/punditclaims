// Loads the working data tree: every record file, validated against its
// schema, with cross-file references and recomputed hashes checked. The
// release builder, the gate, and `npm run validate` use this. Pages never do:
// they read only the frozen release through src/lib/published.ts.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import { SUBJECT_IDS } from "../policy.ts";
import {
  ActivationReceipt, Assessment, ClaimRevision, CurrentRelease, Dispute, Event, EvidencePacket, FetchEvent, Invalidation,
  Occurrence, ResolutionContract, ReviewRun, SourceDocument, SourceVersion, Subject,
} from "../schema.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "./canonical.ts";

export const FIXTURE_PREFIX = "fx-";

export type Problem = { file: string; message: string };
export type Store = {
  root: string;
  subjects: Map<string, Subject>;
  documents: Map<string, SourceDocument>;
  versions: Map<string, SourceVersion>;          // by snapshot hash
  // The same text can be published at two addresses (a syndicated wire story),
  // so a snapshot hash alone does not name one document's version.
  versionsByDoc: Map<string, SourceVersion>;     // by "<document_id>/<snapshot hash>"
  fetches: Map<string, FetchEvent>;
  occurrences: Map<string, Occurrence>;
  claims: Map<string, ClaimRevision[]>;          // revisions in order
  contracts: Map<string, ResolutionContract[]>;  // by claim id, versions in order
  packets: Map<string, EvidencePacket>;
  reviews: Map<string, ReviewRun>;
  assessments: Map<string, Assessment>;
  events: Map<string, Event>;
  invalidations: Map<string, Invalidation>;
  disputes: Map<string, Dispute>;
  activations: Map<string, ActivationReceipt>;
  current: z.infer<typeof CurrentRelease> | null;
  problems: Problem[];
};

// YAML 1.2 core schema keeps 2026-01-02 a string; no Date objects anywhere.
export function parseFile(file: string): unknown {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".json")) return JSON.parse(text);
  const doc = YAML.parseDocument(text, { schema: "core", uniqueKeys: true, merge: false });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  return doc.toJS({ maxAliasCount: 0 });
}

function list(dir: string, ext = /\.(ya?ml|json)$/): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => ext.test(f)).sort().map((f) => path.join(dir, f));
}
const dirs = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);
const stem = (file: string) => path.basename(file).replace(/\.(ya?ml|json)$/, "");

export function loadStore(root: string, opts: { allowFixtures?: boolean } = {}): Store {
  const s: Store = {
    root, subjects: new Map(), documents: new Map(), versions: new Map(), versionsByDoc: new Map(), fetches: new Map(), occurrences: new Map(), claims: new Map(),
    contracts: new Map(), packets: new Map(), reviews: new Map(), assessments: new Map(), events: new Map(), invalidations: new Map(),
    disputes: new Map(), activations: new Map(), current: null, problems: [],
  };
  const rel = (f: string) => path.relative(root, f);
  const bad = (f: string, message: string) => s.problems.push({ file: rel(f), message });
  function read<T>(file: string, schema: z.ZodType<T>): T | null {
    let raw: unknown;
    try { raw = parseFile(file); } catch (err) { bad(file, `does not parse: ${(err as Error).message}`); return null; }
    const r = schema.safeParse(raw);
    if (!r.success) { for (const i of r.error.issues.slice(0, 5)) bad(file, `${i.path.join(".") || "(root)"}: ${i.message}`); return null; }
    return r.data;
  }
  const idCheck = (file: string, id: string, expected = stem(file)) => {
    if (id !== expected) bad(file, `id ${id} does not match its file name ${expected}`);
    if (!opts.allowFixtures && id.startsWith(FIXTURE_PREFIX)) bad(file, `${id} is a fixture id; fixtures never enter the data tree`);
  };
  const d = (...p: string[]) => path.join(root, ...p);

  for (const f of list(d("subjects"))) { const x = read(f, Subject); if (x) { idCheck(f, x.id); s.subjects.set(x.id, x); } }
  for (const id of SUBJECT_IDS) if (!s.subjects.has(id) && fs.existsSync(d("subjects"))) bad(d("subjects"), `missing subject ${id}`);

  for (const doc of dirs(d("sources"))) {
    const f = d("sources", doc, "document.yaml");
    const x = fs.existsSync(f) ? read(f, SourceDocument) : (bad(f, "missing document.yaml"), null);
    if (x) { idCheck(f, x.document_id, doc); s.documents.set(x.document_id, x); }
    for (const vf of list(d("sources", doc, "versions"))) {
      const v = read(vf, SourceVersion);
      if (!v) continue;
      if (v.snapshot_hash !== stem(vf)) bad(vf, "a version file is named by its snapshot hash");
      if (v.document_id !== doc) bad(vf, `belongs to ${v.document_id}, filed under ${doc}`);
      s.versions.set(v.snapshot_hash, v);
      s.versionsByDoc.set(`${v.document_id}/${v.snapshot_hash}`, v);
    }
  }
  for (const f of list(d("source-fetches"))) { const x = read(f, FetchEvent); if (x) { idCheck(f, x.fetch_event_id); s.fetches.set(x.fetch_event_id, x); } }
  for (const f of list(d("occurrences"))) { const x = read(f, Occurrence); if (x) { idCheck(f, x.id); s.occurrences.set(x.id, x); } }
  for (const cid of dirs(d("claims"))) {
    const revs: ClaimRevision[] = [];
    for (const f of list(d("claims", cid, "revisions"))) {
      const x = read(f, ClaimRevision);
      if (!x) continue;
      idCheck(f, x.claim_id, cid);
      if (String(x.revision) !== stem(f)) bad(f, `revision ${x.revision} filed as ${stem(f)}`);
      if (hashOf(x, OWN_DIGEST_FIELDS.claim) !== x.content_hash) bad(f, "content_hash does not match the content");
      revs.push(x);
    }
    revs.sort((a, b) => a.revision - b.revision);
    revs.forEach((r, i) => { if (r.revision !== i + 1) bad(d("claims", cid), `revisions must run 1..n; found ${revs.map((x) => x.revision).join(",")}`); });
    if (revs.length) s.claims.set(cid, revs);
  }
  for (const cid of dirs(d("contracts"))) {
    const vs: ResolutionContract[] = [];
    for (const f of list(d("contracts", cid))) {
      const x = read(f, ResolutionContract);
      if (!x) continue;
      idCheck(f, x.claim_id, cid);
      if (String(x.version) !== stem(f)) bad(f, `version ${x.version} filed as ${stem(f)}`);
      if (hashOf(x, OWN_DIGEST_FIELDS.contract) !== x.content_hash) bad(f, "content_hash does not match the content");
      vs.push(x);
    }
    vs.sort((a, b) => a.version - b.version);
    if (vs.length) s.contracts.set(cid, vs);
  }
  for (const f of list(d("evidence"))) {
    const x = read(f, EvidencePacket);
    if (!x) continue;
    idCheck(f, x.packet_id);
    if (hashOf(x, OWN_DIGEST_FIELDS.packet) !== x.packet_hash) bad(f, "packet_hash does not match the content");
    s.packets.set(x.packet_id, x);
  }
  for (const f of list(d("reviews"))) { const x = read(f, ReviewRun); if (x) { idCheck(f, x.run_id); s.reviews.set(x.run_id, x); } }
  for (const f of list(d("assessments"))) {
    const x = read(f, Assessment);
    if (!x) continue;
    idCheck(f, x.assessment_id);
    if (hashOf(x.public_payload) !== x.public_payload_hash) bad(f, "public_payload_hash does not match the payload");
    s.assessments.set(x.assessment_id, x);
  }
  for (const f of list(d("events"))) { const x = read(f, Event); if (x) { idCheck(f, x.event_id); s.events.set(x.event_id, x); } }
  for (const f of list(d("invalidations"))) { const x = read(f, Invalidation); if (x) { idCheck(f, x.invalidation_id); s.invalidations.set(x.invalidation_id, x); } }
  for (const f of list(d("disputes"))) { const x = read(f, Dispute); if (x) { idCheck(f, x.dispute_id); s.disputes.set(x.dispute_id, x); } }
  for (const f of list(d("activations"))) { const x = read(f, ActivationReceipt); if (x) { idCheck(f, x.activation_id); s.activations.set(x.activation_id, x); } }
  if (fs.existsSync(d("current-release.json"))) s.current = read(d("current-release.json"), CurrentRelease);

  crossCheck(s, bad, d);
  return s;
}

export const latestRevision = (s: Store, claimId: string) => s.claims.get(claimId)?.at(-1) ?? null;
export function revisionByHash(s: Store, claimId: string, hash: string) { return s.claims.get(claimId)?.find((r) => r.content_hash === hash) ?? null; }
export function contractByHash(s: Store, claimId: string, hash: string) { return s.contracts.get(claimId)?.find((k) => k.content_hash === hash) ?? null; }

function crossCheck(s: Store, bad: (f: string, m: string) => void, d: (...p: string[]) => string) {
  for (const o of s.occurrences.values()) {
    const f = d("occurrences", `${o.id}.yaml`);
    if (!s.documents.has(o.document_id)) bad(f, `document ${o.document_id} does not exist`);
    for (const r of o.source_version_receipts) {
      const v = s.versionsByDoc.get(`${o.document_id}/${r.source_snapshot_id}`) ?? s.versions.get(r.source_snapshot_id);
      if (!v) bad(f, `source version ${r.source_snapshot_id.slice(0, 12)} does not exist`);
      else if (v.document_id !== o.document_id) bad(f, `source version ${r.source_snapshot_id.slice(0, 12)} belongs to ${v.document_id}`);
    }
    for (const c of o.claim_ids) if (!s.claims.has(c)) bad(f, `claim ${c} does not exist`);
    if (o.endorsement_status === "endorsed" && o.attributed_speaker !== o.subject_id) bad(f, "an endorsed statement is attributed to its subject");
  }
  for (const [cid, revs] of s.claims) {
    for (const r of revs) {
      const f = d("claims", cid, "revisions", `${r.revision}.yaml`);
      for (const oid of r.occurrence_ids) {
        const o = s.occurrences.get(oid);
        if (!o) { bad(f, `occurrence ${oid} does not exist`); continue; }
        if (o.subject_id !== r.subject_id) bad(f, `occurrence ${oid} belongs to ${o.subject_id}`);
        if (o.endorsement_status !== "endorsed") bad(f, `occurrence ${oid} is ${o.endorsement_status}; a subject's claim rests on statements the subject endorsed`);
      }
      if (r.relation_to_prior_claim && !s.claims.has(r.relation_to_prior_claim.claim_id)) bad(f, `prior claim ${r.relation_to_prior_claim.claim_id} does not exist`);
      if (revs.some((x) => x.subject_id !== r.subject_id)) bad(f, "a claim keeps one subject across revisions");
    }
  }
  for (const [cid, vs] of s.contracts) {
    for (const k of vs) {
      const f = d("contracts", cid, `${k.version}.yaml`);
      if (!revisionByHash(s, cid, k.claim_revision_ref.content_hash)) bad(f, "claim_revision_ref matches no revision of its claim");
    }
  }
  for (const p of s.packets.values()) {
    const f = d("evidence", `${p.packet_id}.json`);
    const cid = p.claim_revision_ref.id;
    if (!revisionByHash(s, cid, p.claim_revision_ref.content_hash)) bad(f, "claim_revision_ref matches no revision");
    if (!contractByHash(s, p.contract_ref.id, p.contract_ref.content_hash)) bad(f, "contract_ref matches no contract");
    for (const i of p.evidence_items) {
      if (!s.documents.has(i.document_id)) bad(f, `${i.id}: document ${i.document_id} does not exist`);
      const v = s.versionsByDoc.get(`${i.document_id}/${i.source_snapshot_id}`);
      if (!v) bad(f, s.versions.has(i.source_snapshot_id) ? `${i.id}: source version belongs to ${s.versions.get(i.source_snapshot_id)!.document_id}` : `${i.id}: source version does not exist`);
    }
  }
  for (const a of s.assessments.values()) {
    const f = d("assessments", `${a.assessment_id}.json`);
    const cid = a.claim_revision_ref.id;
    if (!revisionByHash(s, cid, a.claim_revision_ref.content_hash)) bad(f, "claim_revision_ref matches no revision");
    if (!contractByHash(s, cid, a.contract_ref.content_hash)) bad(f, "contract_ref matches no contract");
    const p = s.packets.get(a.packet_ref.id);
    if (!p) bad(f, `packet ${a.packet_ref.id} does not exist`);
    else if (p.packet_hash !== a.packet_ref.content_hash) bad(f, "packet_ref hash does not match the packet");
    for (const r of [...a.reviewer_run_ids, ...(a.final_text_run_id ? [a.final_text_run_id] : [])]) if (!s.reviews.has(r)) bad(f, `review run ${r} does not exist`);
    if (a.supersedes_assessment_id && !s.assessments.has(a.supersedes_assessment_id)) bad(f, `superseded assessment ${a.supersedes_assessment_id} does not exist`);
    if (a.public_payload.claim_id !== cid) bad(f, "the public payload names a different claim");
  }
  for (const e of s.events.values()) {
    const f = d("events", `${e.event_id}.json`);
    if (e.claim_id && !s.claims.has(e.claim_id)) bad(f, `claim ${e.claim_id} does not exist`);
    if (e.assessment_id && !s.assessments.has(e.assessment_id)) bad(f, `assessment ${e.assessment_id} does not exist`);
    if (e.predecessor_event_id && !s.events.has(e.predecessor_event_id)) bad(f, `predecessor event ${e.predecessor_event_id} does not exist`);
  }
  for (const i of s.invalidations.values()) if (!s.assessments.has(i.assessment_id)) bad(d("invalidations", `${i.invalidation_id}.json`), `assessment ${i.assessment_id} does not exist`);
}
