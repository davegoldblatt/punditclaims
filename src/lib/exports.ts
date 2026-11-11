// The public export projections. Every export names the release it came from
// (id, digest, cutoffs, policy and schema versions) and carries the release's
// own records unchanged, plus addresses on this site. No export adds a fact
// the release does not have.
//
// Claims are split into parts of PART_SIZE so that no file passes the 25 MiB
// a Cloudflare Pages file may hold: a release of 11,000 claims is about 60 MB
// of JSON. The release export keeps every other manifest field in one file and
// lists its parts; joining the parts' claims arrays in order rebuilds the
// manifest exactly, and its digest then matches.
import type { PublicClaim, ReleaseManifest } from "./manifest.ts";
import { assessmentLabel, assessmentPath, bySaid, claimPath, standingOf, versionsOf } from "./view.ts";

export const PART_SIZE = 1000;

export function releaseIdentity(m: ReleaseManifest) {
  return {
    release_id: m.release_id,
    digest: m.digest,
    generated_at: m.generated_at,
    reference_date: m.reference_date,
    source_cutoff: m.source_cutoff,
    evaluation_cutoff: m.evaluation_cutoff,
    policy_version: m.policy_version,
    schema_version: m.schema_version,
    fixture: m.fixture,
  };
}

export const NOT_PUBLISHED = { kind: "punditclaims-release", release_id: null, status: "not_published", note: "No release has been published yet." } as const;

export function claimExport(c: PublicClaim, origin: string) {
  return {
    url: `${origin}${claimPath(c.claim_id)}`,
    standing: standingOf(c),
    assessment_label: assessmentLabel(c),
    versions: versionsOf(c).map((a) => ({ assessment_id: a.assessment_id, status: a.status, url: `${origin}${assessmentPath(c, a.assessment_id)}` })),
    claim: c,
  };
}

export const partCount = (n: number): number => Math.max(1, Math.ceil(n / PART_SIZE));
const slice = <T,>(xs: T[], n: number): T[] => xs.slice((n - 1) * PART_SIZE, n * PART_SIZE);

// --- the release manifest, in parts (manifest order) -------------------------------
export const releasePartPath = (rid: string, n: number): string => `/api/releases/${rid}/claims-${n}.json`;

// The manifest without its claims, plus the list of parts that hold them.
export function releaseHead(m: ReleaseManifest, origin: string) {
  const { claims, ...rest } = m;
  const parts = Array.from({ length: partCount(claims.length) }, (_, i) => ({ url: `${origin}${releasePartPath(m.release_id, i + 1)}`, claims: slice(claims, i + 1).length }));
  return {
    ...rest,
    claims_in_parts: {
      note: "The claims are split across these files so that no file is too large to serve. Join their claims arrays in this order to rebuild the manifest; its digest is computed over the rebuilt manifest.",
      total: claims.length,
      parts,
    },
  };
}

export function releasePart(m: ReleaseManifest, n: number) {
  return { kind: "punditclaims-release-claims", release_id: m.release_id, digest: m.digest, part: n, parts: partCount(m.claims.length), claims: slice(m.claims, n) };
}

// --- the claims export, in parts (newest statement first) ------------------------------
export const claimsPartPath = (n: number): string => `/api/claims/part-${n}.json`;
export const claimsInOrder = (claims: PublicClaim[]): PublicClaim[] => [...claims].sort(bySaid);

const partIndex = new WeakMap<PublicClaim[], Map<string, number>>();
// Which part of the claims export holds a claim.
export function claimsPartOf(claims: PublicClaim[], id: string): number {
  let m = partIndex.get(claims);
  if (!m) partIndex.set(claims, (m = new Map(claimsInOrder(claims).map((c, i) => [c.claim_id, Math.floor(i / PART_SIZE) + 1]))));
  return m.get(id) ?? 1;
}

export function claimsPart(m: ReleaseManifest, n: number, origin: string) {
  const ordered = claimsInOrder(m.claims);
  return { ...releaseIdentity(m), part: n, parts: partCount(ordered.length), claims: slice(ordered, n).map((c) => claimExport(c, origin)) };
}
