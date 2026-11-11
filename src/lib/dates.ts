// Partial dates (YYYY, YYYY-MM, YYYY-MM-DD, or a UTC timestamp) as day
// ranges. A comparison that could go either way uses the side that does not
// overstate: "available by" uses the latest day a date could mean, "happened
// after" uses the earliest.
const DAY_MS = 86_400_000;

function parts(d: string): { y: number; m: number | null; day: number | null } {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(d);
  if (!m) throw new Error(`not a date: ${d}`);
  return { y: Number(m[1]), m: m[2] ? Number(m[2]) : null, day: m[3] ? Number(m[3]) : null };
}

export function earliestDay(d: string): string {
  const p = parts(d);
  return `${p.y}-${String(p.m ?? 1).padStart(2, "0")}-${String(p.day ?? 1).padStart(2, "0")}`;
}

export function latestDay(d: string): string {
  const p = parts(d);
  if (p.day) return earliestDay(d);
  const month = p.m ?? 12;
  const last = new Date(Date.UTC(p.y, month, 0)).getUTCDate();
  return `${p.y}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export const dayOf = (timestamp: string): string => timestamp.slice(0, 10);

// a ≤ b on whole days.
export const onOrBefore = (a: string, b: string): boolean => a <= b;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// Two partial dates or intervals can describe the same days.
export function overlaps(aStart: string, aEnd: string, bStart: string | null, bEnd: string | null): boolean {
  const lo = bStart ? earliestDay(bStart) : "0000-01-01";
  const hi = bEnd ? latestDay(bEnd) : "9999-12-31";
  return earliestDay(aStart) <= hi && latestDay(aEnd) >= lo;
}
