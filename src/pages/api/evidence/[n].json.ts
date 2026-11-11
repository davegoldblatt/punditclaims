// /api/evidence/<n>.json: the details Explore shows when a reader opens a
// claim's evidence, in SHARDS files so a reader fetches about 1/64 of the set.
// Per live claim: the assessment id and cutoff, our rationale, limitations,
// each evidence item (relation, publisher, link, dates, excerpt, explanation),
// and the citation the claim page uses.
import { release } from "../../../lib/published.ts";
import { SITE } from "../../../site.ts";
import { citation, isScreenedOut } from "../../../lib/view.ts";
import { SHARDS, shardOf } from "../../../lib/shard.ts";

export function getStaticPaths() {
  return Array.from({ length: SHARDS }, (_, n) => ({ params: { n: String(n) } }));
}
export function GET({ params }: { params: { n: string } }) {
  const r = release();
  const m = r.manifest;
  const n = Number(params.n);
  const out: Record<string, unknown> = {};
  if (m) for (const c of r.live) {
    if (shardOf(c.claim_id) !== n) continue;
    const a = c.current!;
    const p = a.payload;
    const name = r.subject(c.subject_id)?.name ?? c.subject_id;
    out[c.claim_id] = {
      assessment: a.assessment_id, as_of: isScreenedOut(a) ? null : p.evaluation_as_of, rationale: p.rationale, limitations: p.limitations,
      evidence: p.evidence.map((e) => ({ relation: e.relation, publisher: e.publisher, url: e.url, event_date: e.event_date, available_at: e.available_at, excerpt: e.excerpt, explanation: e.explanation })),
      citation: citation(m, c, a, SITE.origin, name),
      quote: `“${p.statement.excerpt}” ${name}, ${p.statement.date}, ${p.statement.document_title}.`,
    };
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
