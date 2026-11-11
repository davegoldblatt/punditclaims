// What a review is bound to. A review or final-text check counts only for the
// exact case it saw: the claim, the contract, the evidence packet (which
// carries every evidence receipt), every statement receipt (source version,
// span, quotation hash, and public excerpt), the policy version, and the
// prompt. Change any of those and the old review no longer counts.
import type { ClaimRevision, EvidencePacket, ResolutionContract } from "../schema.ts";
import type { Store } from "./data.ts";
import { hashOf } from "./canonical.ts";

function occurrencesOf(s: Store, claim: ClaimRevision) {
  return claim.occurrence_ids.map((oid) => {
    const o = s.occurrences.get(oid);
    return o
      ? { id: o.id, document_id: o.document_id, speaker: o.attributed_speaker, endorsement: o.endorsement_status, date: o.statement_date,
          receipts: o.source_version_receipts.map((r) => ({ snapshot: r.source_snapshot_id, span: r.source_span, quote_hash: r.quote_hash, excerpt: r.public_excerpt, locator: r.excerpt_locator })) }
      : { id: oid, missing: true };
  });
}

export function caseDigest(s: Store, claim: ClaimRevision, contract: ResolutionContract, packet: EvidencePacket, policyVersion: string, promptHash: string): string {
  return hashOf({ claim: claim.content_hash, contract: contract.content_hash, packet: packet.packet_hash, occurrences: occurrencesOf(s, claim), policy_version: policyVersion, prompt: promptHash });
}

// The screen (policy .7) runs before any contract exists, so it is bound to
// the claim and its statements only. A screened-out claim's contract, packet,
// and public text are then composed by code, and the gate recomputes them.
export function claimDigest(s: Store, claim: ClaimRevision, policyVersion: string, promptHash: string): string {
  return hashOf({ claim: claim.content_hash, occurrences: occurrencesOf(s, claim), policy_version: policyVersion, prompt: promptHash });
}
