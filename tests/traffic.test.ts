import { test } from "node:test";
import assert from "node:assert/strict";
import { leftOutSentence, splitSweeps, type PathRow, type RefRow, type WindowRow } from "../scripts/lib/traffic.ts";

const HOSTS = ["example.org", "www.example.org"];
const many = (window: string, n: number, prefix: string): PathRow[] => Array.from({ length: n }, (_, i) => ({ window, path: `${prefix}${i}`, loads: 1 }));

// The shape seen on 2026-11-11: people browsing, then a program loading one
// page per visit, every page different, nobody linking in.
test("a sweep is left out and people are kept", () => {
  const windows: WindowRow[] = [
    { window: "2026-11-11T21:30:00Z", loads: 25, visits: 5 },
    { window: "2026-11-11T21:45:00Z", loads: 32, visits: 32 },
    { window: "2026-11-11T22:00:00Z", loads: 1506, visits: 1505 },
    { window: "2026-11-11T23:00:00Z", loads: 4, visits: 3 },
  ];
  const paths: PathRow[] = [
    { window: "2026-11-11T21:30:00Z", path: "/", loads: 5 }, ...many("2026-11-11T21:30:00Z", 20, "/claims/p"),
    { window: "2026-11-11T21:45:00Z", path: "/", loads: 3 }, ...many("2026-11-11T21:45:00Z", 29, "/claims/a"),
    { window: "2026-11-11T22:00:00Z", path: "/", loads: 36 }, ...many("2026-11-11T22:00:00Z", 1470, "/claims/b"),
    { window: "2026-11-11T23:00:00Z", path: "/", loads: 4 },
  ];
  const refs: RefRow[] = [
    { window: "2026-11-11T21:30:00Z", host: "", loads: 3 }, { window: "2026-11-11T21:30:00Z", host: "news.ycombinator.com", loads: 2 }, { window: "2026-11-11T21:30:00Z", host: "example.org", loads: 20 },
    { window: "2026-11-11T21:45:00Z", host: "", loads: 32 },
    { window: "2026-11-11T22:00:00Z", host: "", loads: 1504 }, { window: "2026-11-11T22:00:00Z", host: "news.ycombinator.com", loads: 1 }, { window: "2026-11-11T22:00:00Z", host: "example.org", loads: 1 },
    { window: "2026-11-11T23:00:00Z", host: "news.ycombinator.com", loads: 4 },
  ];
  const { people, left_out } = splitSweeps(windows, paths, refs, HOSTS);
  assert.deepEqual({ pageviews: people?.pageviews, visits: people?.visits }, { pageviews: 29, visits: 8 });
  assert.deepEqual(people?.pages[0], { path: "/", views: 9 });
  assert.deepEqual(people?.referrers, [{ host: "news.ycombinator.com", views: 6 }]);
  assert.equal(left_out?.loads, 1538);
  assert.equal(left_out?.visits, 1537);
  assert.deepEqual(left_out?.spans, [{ start: "2026-11-11T21:45:00.000Z", end: "2026-11-11T22:15:00.000Z", loads: 1538 }]);
  assert.match(leftOutSentence(left_out!), /^Left out 1,538 more page loads .*\(Wed, Nov 11, 1:45 PM to 2:15 PM PT\)\.$/);
});

// A crowd from one link is busy but lands on a few pages: never left out.
test("a real crowd is not a sweep", () => {
  const w = "2026-11-12T16:00:00Z";
  const windows: WindowRow[] = [{ window: w, loads: 300, visits: 290 }];
  const paths: PathRow[] = [{ window: w, path: "/", loads: 250 }, { window: w, path: "/people/a", loads: 50 }];
  const refs: RefRow[] = [{ window: w, host: "", loads: 200 }, { window: w, host: "news.ycombinator.com", loads: 100 }];
  const { people, left_out } = splitSweeps(windows, paths, refs, HOSTS);
  assert.equal(left_out, null);
  assert.equal(people?.pageviews, 300);
});

// One reader clicking through many pages makes few visits: never left out.
test("one person browsing many pages is not a sweep", () => {
  const w = "2026-11-12T17:00:00Z";
  const { left_out } = splitSweeps([{ window: w, loads: 40, visits: 1 }], many(w, 40, "/claims/c"), [{ window: w, host: "", loads: 1 }, { window: w, host: "example.org", loads: 39 }], HOSTS);
  assert.equal(left_out, null);
});

test("two sweeps apart stay two spans, and nothing at all gives no people", () => {
  const a = "2026-11-12T01:00:00Z", b = "2026-11-12T05:00:00Z";
  const { people, left_out } = splitSweeps(
    [{ window: a, loads: 30, visits: 30 }, { window: b, loads: 40, visits: 40 }],
    [...many(a, 30, "/x"), ...many(b, 40, "/y")],
    [{ window: a, host: "", loads: 30 }, { window: b, host: "", loads: 40 }],
    HOSTS,
  );
  assert.equal(left_out?.spans.length, 2);
  assert.deepEqual({ pageviews: people?.pageviews, visits: people?.visits, pages: people?.pages }, { pageviews: 0, visits: 0, pages: [] });
  assert.equal(splitSweeps([], [], [], HOSTS).people, null);
});
