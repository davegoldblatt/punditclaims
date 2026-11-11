// Constructors that seal a record: they fill its own digest from its content
// so callers cannot hand-write a hash. Every writer (extraction, contracts,
// packets, assessments, fixtures) goes through these.
import type { Assessment, ClaimRevision, EvidencePacket, PublicPayload, Ref, ResolutionContract } from "../schema.ts";
import { hashOf, OWN_DIGEST_FIELDS } from "./canonical.ts";

export function sealClaim(c: Omit<ClaimRevision, "content_hash">): ClaimRevision {
  return { ...c, content_hash: hashOf(c, OWN_DIGEST_FIELDS.claim) };
}
export function sealContract(k: Omit<ResolutionContract, "content_hash">): ResolutionContract {
  return { ...k, content_hash: hashOf(k, OWN_DIGEST_FIELDS.contract) };
}
export function sealPacket(p: Omit<EvidencePacket, "packet_hash">): EvidencePacket {
  return { ...p, packet_hash: hashOf(p, OWN_DIGEST_FIELDS.packet) };
}
export function sealAssessment(a: Omit<Assessment, "public_payload_hash">): Assessment {
  return { ...a, public_payload_hash: payloadHash(a.public_payload) };
}
export const payloadHash = (p: PublicPayload): string => hashOf(p);

export const claimRef = (c: ClaimRevision): Ref => ({ id: c.claim_id, version: c.revision, content_hash: c.content_hash });
export const contractRef = (k: ResolutionContract): Ref => ({ id: k.claim_id, version: k.version, content_hash: k.content_hash });
export const packetRef = (p: EvidencePacket) => ({ id: p.packet_id, content_hash: p.packet_hash });
