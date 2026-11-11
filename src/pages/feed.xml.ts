// /feed.xml: RSS 2.0, one item per substantive event, newest first, up to
// FEED_ITEMS items: a release of thousands of claims has thousands of
// events, and /changes lists them all. The GUID is the event id, so
// regenerating the feed never duplicates an item. Copy edits are not findings
// and are left out.
import { release } from "../lib/published.ts";
import { SITE } from "../site.ts";
import { EVENT_LABEL } from "../policy.ts";
import { assessmentPath, byNewest, claimPath, EVENT_GROUP_LABEL, eventGroup, versionsOf } from "../lib/view.ts";
import { changesPageOf, changesPath, FEED_ITEMS } from "../lib/listing.ts";


const x = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const rfc822 = (ts: string) => new Date(ts).toUTCString();

export function GET() {
  const r = release();
  const m = r.manifest;
  const items = r.events.filter((e) => e.substantive).sort(byNewest).slice(0, FEED_ITEMS).map((e) => {
    const c = e.claim_id ? r.claim(e.claim_id) : null;
    const person = e.subject_id ? r.subject(e.subject_id)?.name ?? "" : "";
    const published = c && e.assessment_id && versionsOf(c).some((a) => a.assessment_id === e.assessment_id);
    const link = c && published ? assessmentPath(c, e.assessment_id!) : c ? claimPath(c.claim_id) : `${changesPath(changesPageOf(r.events, e.event_id) ?? 1)}#event-${e.event_id}`;
    const title = `${EVENT_LABEL[e.type]}${person ? `, ${person}` : ""}: ${c ? c.normalized_proposition : e.reason}`;
    const desc = [e.reason, m ? `Release ${m.release_id}.` : ""].filter(Boolean).join(" ");
    return [
      "    <item>",
      `      <title>${x(title)}</title>`,
      `      <link>${x(SITE.origin + link)}</link>`,
      `      <guid isPermaLink="false">punditclaims-event-${x(e.event_id)}</guid>`,
      `      <pubDate>${rfc822(e.recorded_at)}</pubDate>`,
      `      <category>${x(EVENT_GROUP_LABEL[eventGroup(e.type)])}</category>`,
      `      <description>${x(desc)}</description>`,
      "    </item>",
    ].join("\n");
  });
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${x(SITE.name)}: changes</title>`,
    `    <link>${x(SITE.origin)}/changes</link>`,
    `    <atom:link href="${x(SITE.origin)}/feed.xml" rel="self" type="application/rss+xml" />`,
    `    <description>${x(m ? `The newest substantive changes to the register, up to ${FEED_ITEMS}. Every change is listed at ${SITE.origin}/changes. Release ${m.release_id}, reference date ${m.reference_date}.` : "No release has been published yet.")}</description>`,
    "    <language>en</language>",
    ...(m ? [`    <lastBuildDate>${rfc822(m.generated_at)}</lastBuildDate>`] : []),
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
