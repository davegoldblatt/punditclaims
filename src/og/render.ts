import { SITE } from "../site.ts";
// Share images (1200x630 PNG). A claim card carries exactly four things from
// the release: the proposition, the person, the assessment label, and the
// dates. No generated summary. Satori needs static TTF instances and crashes
// on undefined style values, so every style object below is fully defined.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";

// Resolved from the project root: at build time this module runs from a
// bundled chunk, so import.meta.url would point at the wrong place.
const font = (name: string) => fs.readFileSync(path.resolve(process.cwd(), `src/og/${name}.ttf`));
const FONTS = [
  { name: "Public Sans", data: font("PublicSans-400"), weight: 400 as const, style: "normal" as const },
  { name: "Public Sans", data: font("PublicSans-700"), weight: 700 as const, style: "normal" as const },
];

const PAPER = "#ffffff", INK = "#1b1d22", SOFT = "#545b67", RULE = "#d6d9df", ACCENT = "#3b2d9e";
const W = 1200, H = 630, PAD = 64;

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, string | number>, children: unknown = ""): Node => ({ type, props: { style, children } });

function propSize(len: number): number {
  if (len <= 90) return 58;
  if (len <= 150) return 48;
  if (len <= 230) return 40;
  if (len <= 330) return 34;
  if (len <= 450) return 29;
  return 25;
}

function frame(children: Node[], synthetic: boolean, host: string): Node {
  return h("div", { display: "flex", flexDirection: "column", width: W, height: H, backgroundColor: PAPER, color: INK, fontFamily: "Public Sans", borderTop: `14px solid ${ACCENT}` }, [
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", padding: `34px ${PAD}px 0` }, [
      h("div", { display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }, "Pundit Claims"),
      synthetic
        ? h("div", { display: "flex", fontSize: 22, fontWeight: 700, color: PAPER, backgroundColor: ACCENT, padding: "6px 14px", borderRadius: 4 }, "Synthetic preview, not a real record")
        : h("div", { display: "flex", fontSize: 22, color: SOFT }, host),
    ]),
    ...children,
  ]);
}

export type ClaimCard = { person: string; kind: string; proposition: string; label: string; flags: string[]; said: string; evidenceAsOf: string | null; synthetic: boolean; host: string };

export async function renderClaimCard(c: ClaimCard): Promise<Buffer> {
  const size = propSize(c.proposition.length);
  const labels = [c.label, ...c.flags].map((t, i) =>
    h("div", { display: "flex", fontSize: 28, fontWeight: 700, padding: "6px 16px", border: `3px solid ${i === 0 ? INK : ACCENT}`, borderRadius: 5, backgroundColor: i === 0 ? PAPER : "#eeebfb", color: INK }, t));
  const dates = [`Said ${c.said}`, ...(c.evidenceAsOf ? [`Evidence as of ${c.evidenceAsOf}`] : [])];
  const tree = frame([
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", padding: `0 ${PAD}px`, gap: 18 }, [
      h("div", { display: "flex", fontSize: 26, color: SOFT }, `${c.person}, ${c.kind.toLowerCase()}`),
      h("div", { display: "flex", fontSize: size, fontWeight: 700, lineHeight: 1.18, letterSpacing: -0.5, maxWidth: W - 2 * PAD }, c.proposition),
    ]),
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, padding: `22px ${PAD}px 40px`, borderTop: `2px solid ${RULE}`, margin: `0 ${PAD}px`, paddingLeft: 0, paddingRight: 0 }, [
      h("div", { display: "flex", gap: 12 }, labels),
      h("div", { display: "flex", gap: 28, fontSize: 24, color: SOFT }, dates.map((d) => h("div", { display: "flex" }, d))),
    ]),
  ], c.synthetic, c.host);
  return render(tree);
}

export async function renderSiteCard(o: { line: string; synthetic: boolean; host: string }): Promise<Buffer> {
  const tree = frame([
    h("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", padding: `0 ${PAD}px`, gap: 26 }, [
      h("div", { display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.2, maxWidth: 1000 }, `${SITE.tagline}.`),
      h("div", { display: "flex", fontSize: 30, color: SOFT, lineHeight: 1.35, maxWidth: 1000 }, "The exact words, the dated evidence, the assessment, and what changed. No score."),
    ]),
    h("div", { display: "flex", padding: `22px 0 40px`, margin: `0 ${PAD}px`, borderTop: `2px solid ${RULE}`, fontSize: 24, color: SOFT }, o.line),
  ], o.synthetic, o.host);
  return render(tree);
}

async function render(tree: Node): Promise<Buffer> {
  const svg = await satori(tree as any, { width: W, height: H, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}
