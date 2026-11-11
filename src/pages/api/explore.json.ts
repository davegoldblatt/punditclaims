// /api/explore.json: everything the Explore page filters, for every live claim,
// built from the release. One record per claim: id, person, companies,
// topics, kind, outcome, year and date first said, our reading, the speaker's
// words, the claim's address, what settled it (settled claims only), and
// any probable call. Held records with a probable call come separately. The page loads it on demand and filters in
// the browser. scripts/check-dist.ts checks it against the release.
import { release } from "../../lib/published.ts";
import { ENTITIES, entitiesOf } from "../../lib/entities.ts";
import { claimPath, topicLabel, whatHappened } from "../../lib/view.ts";
import { KIND_LABEL, OUTCOME_LABEL } from "../../policy.ts";

export function GET() {
  const r = release();
  const m = r.manifest;
  const claims = [...r.live].sort((a, b) => b.first_statement_date.localeCompare(a.first_statement_date) || a.claim_id.localeCompare(b.claim_id));
  const topics = [...new Set(claims.flatMap((c) => c.topic_tags))].sort();
  const body = {
    release_id: m?.release_id ?? null,
    reference_date: m?.reference_date ?? null,
    labels: {
      person: Object.fromEntries(r.subjects.map((s) => [s.id, s.name])),
      company: Object.fromEntries(ENTITIES.map((e) => [e.id, e.name])),
      topic: Object.fromEntries(topics.map((t) => [t, topicLabel(t)])),
      kind: KIND_LABEL,
      outcome: OUTCOME_LABEL,
    },
    claims: claims.map((c) => {
      const p = c.current!.payload;
      return {
        id: c.claim_id, person: c.subject_id, company: entitiesOf(c), topic: c.topic_tags, kind: c.kind, outcome: p.outcome,
        said: c.first_statement_date, year: c.first_statement_date.slice(0, 4), reading: c.normalized_proposition, words: p.statement.excerpt,
        source: p.statement.document_title, path: claimPath(c.claim_id), checked: c.last_substantive_change_at,
        ...(() => { const w = whatHappened(c); return w.length ? { why: w } : {}; })(),
        ...(c.probable ? { probable: c.probable } : {}),
      };
    }),
    // Held claims with a probable call (docs/adr/0006). They show only at the
    // matching confidence level, with no company, topic, or kind.
    held: r.held.filter((h) => h.probable).map((h) => ({
      id: h.id, person: h.subject_id, company: [], topic: [], kind: h.kind ?? "", outcome: "held", said: h.source.date ?? "", year: (h.source.date ?? "").slice(0, 4),
      reading: h.proposition ?? h.source.title, words: h.excerpt ?? "", source: h.source.title, path: `/held#held-${h.id}`, checked: h.since, held: true, probable: h.probable,
    })),
  };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
