import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../tui/format.js";
import { BANNER_LINES } from "../../tui/banner.js";
import { Canvas, glowGlyph, mixRgb, ramp, PALETTE } from "../../tui/fx.js";
import { MARK, MARK_PX } from "../../tui/welcome/mark.js";
import { INTRO_END_MS, INTRO_ROWS, introFrame } from "../../tui/welcome/intro.js";

describe("mark", () => {
  it("is a square grid of green and white pixels", () => {
    expect(MARK).toHaveLength(MARK_PX);
    for (const row of MARK) expect(row).toMatch(new RegExp(`^[GW]{${MARK_PX}}$`));
  });
  it("keeps the S's two slits open (one from each side)", () => {
    const ink = MARK.map((r) => [r.indexOf("W"), r.lastIndexOf("W")]).filter(([a]) => a >= 0);
    const left = Math.min(...ink.map(([a]) => a));
    const right = Math.max(...ink.map(([, b]) => b));
    // a slit row reaches only one edge of the S block
    const fromRight = ink.some(([a, b]) => a === left && b < right - 3);
    const fromLeft = ink.some(([a, b]) => a > left + 3 && b === right);
    expect(fromRight && fromLeft).toBe(true);
  });
});

describe("introFrame", () => {
  const text = (ms: number): string => stripAnsi(introFrame(ms, 96).render().join("\n"));
  it("keeps a constant height", () => {
    for (const ms of [0, 1000, 4000, 9000, INTRO_END_MS]) {
      expect(introFrame(ms, 96).render()).toHaveLength(INTRO_ROWS);
    }
  });
  it("explains accuracy · speed · cost in one frame mid-way", () => {
    const mid = text(INTRO_END_MS * 0.55);
    for (const w of ["accuracy", "speed", "cost", "real browser"]) expect(mid).toContain(w);
  });
  it("opens on the mark and settles on EVALS alone, with no model names", () => {
    expect(introFrame(600, 96).render().join("")).toContain("▀");
    const end = text(INTRO_END_MS);
    expect(end).toContain(BANNER_LINES[0]);
    expect(end).not.toMatch(/[▀▄]|accuracy|Opus|Grok|Sol|GPT|Claude/);
  });
});

describe("fx helpers", () => {
  it("ramp hits its endpoints and mixRgb clamps", () => {
    expect(ramp([PALETTE.void, PALETTE.brand], 0)).toEqual(PALETTE.void);
    expect(ramp([PALETTE.void, PALETTE.brand], 1)).toEqual(PALETTE.brand);
    expect(mixRgb(PALETTE.void, PALETTE.white, 2)).toEqual(PALETTE.white);
    expect(mixRgb(PALETTE.void, PALETTE.white, -1)).toEqual(PALETTE.void);
  });
  it("glowGlyph runs from blank to block", () => {
    const seq = [0, 0.1, 0.3, 0.5, 0.7, 0.9].map(glowGlyph);
    expect(seq[0]).toBe(" ");
    expect(seq[seq.length - 1]).toBe("■");
    expect(new Set(seq).size).toBeGreaterThan(3);
  });
  it("Canvas.render carries fg and bg codes and trims trailing blanks", () => {
    const cv = new Canvas(3, 1);
    cv.put(0, 0, "▀", PALETTE.brand, PALETTE.white);
    const [row] = cv.render();
    expect(row).toContain("38;2;1;200;81");
    expect(row).toContain("48;2;236;255;243");
    expect(stripAnsi(row)).toBe("▀");
  });
});
