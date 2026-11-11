// The only data import for pages, feeds, exports, search, and share images.
// It reads the release named by data/current-release.json, re-checks its
// digest, schema, payload hashes, and counts, and refuses fixture content.
// With PC_RELEASE=fixture it reads the synthetic release in fixtures/release/
// instead; that mode exists for building the site before real data does, and
// scripts/check-dist.ts refuses to ship its output. With PC_FIXTURE_SCALE=<n>
// as well, it reads the large synthetic release that
// `PC_FIXTURE_SCALE=<n> node fixtures/release/build.ts` writes to .runs/.
import fs from "node:fs";
import path from "node:path";
import { SUBJECT_IDS } from "../policy.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "./canonical.ts";
import { ReleaseManifest, type Counts, type PublicClaim } from "./manifest.ts";

export const FIXTURE_MODE = process.env.PC_RELEASE === "fixture";
const ROOT = process.env.PC_ROOT ?? process.cwd();
// The scale fixture: a synthetic release of about this many claims, never committed.
export const FIXTURE_SCALE = Number(process.env.PC_FIXTURE_SCALE ?? 0) || 0;
export const scaleManifestPath = (n: number, root = ROOT) => path.join(root, `.runs/fixture-scale/manifest-${n}.json`);

export function computeCounts(claims: PublicClaim[], heldCount: number): Counts {
  const inc = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const c: Counts = { distinct_claims: 0, occurrences: 0, held: heldCount, withdrawn: 0, by_subject: {}, by_kind: {}, by_outcome: {}, by_horizon: {}, by_subject_outcome: {} };
  for (const s of SUBJECT_IDS) { c.by_subject[s] = 0; c.by_subject_outcome[s] = {}; }
  for (const cl of claims) {
    if (!cl.current || cl.current.status === "withdrawn") { c.withdrawn++; continue; }
    c.distinct_claims++;
    c.occurrences += cl.occurrences.length;
    inc(c.by_subject, cl.subject_id);
    inc(c.by_kind, cl.kind);
    inc(c.by_outcome, cl.current.payload.outcome);
    inc(c.by_horizon, cl.review.horizon_now);
    inc(c.by_subject_outcome[cl.subject_id], cl.current.payload.outcome);
  }
  return c;
}

export function verifyManifest(raw: unknown, opts: { fixture: boolean }): ReleaseManifest {
  const r = ReleaseManifest.safeParse(raw);
  if (!r.success) throw new Error(`release manifest is invalid: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const m = r.data;
  if (hashOf(m, OWN_DIGEST_FIELDS.manifest) !== m.digest) throw new Error("release manifest digest does not match its content");
  if (m.fixture !== opts.fixture) throw new Error(opts.fixture ? "PC_RELEASE=fixture but the manifest is not a fixture" : "a fixture manifest cannot be the production release");
  const ids = new Set<string>();
  const eventIds = new Set(m.events.map((x) => x.event_id));
  for (const s of m.subjects) if (!SUBJECT_IDS.includes(s.id)) throw new Error(`unknown subject ${s.id}`);
  for (const c of m.claims) {
    if (!opts.fixture && c.claim_id.startsWith("fx-")) throw new Error(`fixture claim ${c.claim_id} in a production release`);
    if (ids.has(c.claim_id)) throw new Error(`claim ${c.claim_id} appears twice`);
    ids.add(c.claim_id);
    for (const a of [c.current, ...c.history]) {
      if (!a) continue;
      if (hashOf(a.payload) !== a.payload_hash) throw new Error(`${c.claim_id}: payload of ${a.assessment_id} does not match its hash`);
      if (a.payload.claim_id !== c.claim_id || a.payload.subject_id !== c.subject_id) throw new Error(`${c.claim_id}: payload of ${a.assessment_id} names another claim or subject`);
      if (a.reviewers[0].provider === a.reviewers[1].provider) throw new Error(`${c.claim_id}: ${a.assessment_id} was reviewed by one provider twice`);
      const screenedOut = !!a.payload.uncheckable?.length && a.payload.outcome === "not_adjudicable" && a.payload.axis === "not_applicable" && a.payload.horizon_state === "not_applicable" && !a.payload.evidence.length;
      if (!a.final_text && !screenedOut) throw new Error(`${c.claim_id}: ${a.assessment_id} has no final-text check and is not a screened-out claim`);
      if (a.final_text && a.final_text.provider === a.drafter.provider) throw new Error(`${c.claim_id}: ${a.assessment_id}'s final text was checked by its drafter's provider`);
    }
    for (const e of c.event_ids) if (!eventIds.has(e)) throw new Error(`${c.claim_id}: event ${e} is missing`);
  }
  for (const h of m.held) if (ids.has(h.id)) throw new Error(`${h.id} is both published and held`);
  const counts = computeCounts(m.claims, m.held.length);
  if (JSON.stringify(counts) !== JSON.stringify(m.counts)) throw new Error("release counts do not match its claims");
  return m;
}

let cached: ReleaseManifest | null | undefined;

// The current release, or null when nothing has been released yet.
export function loadRelease(): ReleaseManifest | null {
  if (cached !== undefined) return cached;
  if (FIXTURE_MODE) {
    const f = FIXTURE_SCALE ? scaleManifestPath(FIXTURE_SCALE) : path.join(ROOT, "fixtures/release/manifest.json");
    return (cached = verifyManifest(JSON.parse(fs.readFileSync(f, "utf8")), { fixture: true }));
  }
  const pointer = path.join(ROOT, "data/current-release.json");
  if (!fs.existsSync(pointer)) return (cached = null);
  const cur = JSON.parse(fs.readFileSync(pointer, "utf8")) as { release_id: string; manifest_digest: string };
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data/releases", cur.release_id, "manifest.json"), "utf8"));
  const m = verifyManifest(raw, { fixture: false });
  if (m.digest !== cur.manifest_digest) throw new Error("data/current-release.json names a different digest than the manifest has");
  return (cached = m);
}

// Convenience views over the one release. Pages use these; none reads data/
// directly. Built once per process: a build renders thousands of pages, and
// every lookup here is by key, not by scanning the release.
type ReleaseView = ReturnType<typeof buildView>;
let view: ReleaseView | undefined;

function buildView() {
  const m = loadRelease();
  const claims = m?.claims ?? [];
  const live = claims.filter((c) => c.current && c.current.status !== "withdrawn");
  const byId = new Map(claims.map((c) => [c.claim_id, c]));
  const subjects = m?.subjects ?? [];
  const events = m?.events ?? [];
  const eventById = new Map(events.map((e) => [e.event_id, e]));
  const eventsByClaim = new Map(claims.map((c) => [c.claim_id, c.event_ids.map((id) => eventById.get(id)!).filter(Boolean)]));
  return {
    manifest: m,
    subjects,
    claims,
    live,
    withdrawn: claims.filter((c) => !c.current || c.current.status === "withdrawn"),
    held: m?.held ?? [],
    events,
    coverage: m?.coverage ?? [],
    counts: m?.counts ?? null,
    claim: (id: string) => byId.get(id) ?? null,
    subject: (id: string) => subjects.find((s) => s.id === id) ?? null,
    // The events a claim names, in the order it names them.
    eventsOf: (id: string) => eventsByClaim.get(id) ?? [],
  };
}

export function release(): ReleaseView {
  return (view ??= buildView());
}
