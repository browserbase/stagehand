import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../tui/format.js";
import {
  Canvas,
  drawParticles,
  glowGlyph,
  mixRgb,
  ramp,
  PALETTE,
  type Particle,
} from "../../tui/fx.js";
import { rasterizeMark } from "../../tui/welcome/mark.js";
import { SHADOW_ROWS, shadowText, shadowWidth } from "../../tui/welcome/shadowFont.js";

describe("shadowText", () => {
  it("typesets upper-cased text into equal-width rows", () => {
    const rows = shadowText("evals");
    expect(rows).toHaveLength(SHADOW_ROWS);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    expect(shadowWidth("evals")).toBe(rows[0].length);
    expect(rows.join("\n")).toContain("███████╗"); // the E
  });
  it("skips characters the face doesn't have", () => {
    expect(shadowWidth("A")).toBe(shadowWidth("A@"));
    expect(shadowWidth("")).toBe(0);
  });
});

describe("rasterizeMark", () => {
  for (const px of [24, 28, 32]) {
    it(`keeps both slits open, binary, at ${px}px`, () => {
      const { cover } = rasterizeMark(px);
      const whitePerRow = Array.from(
        { length: px },
        (_, y) => Array.from(cover.slice(y * px, (y + 1) * px)).filter((c) => c === 1).length,
      );
      const blockRows = whitePerRow.map((n, y) => (n > 0 ? y : -1)).filter((y) => y >= 0);
      expect(blockRows.length).toBeGreaterThan(px * 0.4);
      const fullWidth = Math.max(...whitePerRow);
      // a slit row keeps well under half the block's white: green cuts most of it away
      const slits = blockRows.filter((y) => whitePerRow[y] < fullWidth * 0.5);
      expect(slits.length).toBeGreaterThanOrEqual(2);
      expect(Array.from(cover).every((c) => c === 0 || c === 1)).toBe(true);
    });
  }
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
  it("near particles paint over far ones sharing a cell", () => {
    const cv = new Canvas(4, 1);
    const far: Particle = { x: 1, y: 0, z: 0.1, vx: 0, vy: 0, phase: 0 };
    const near: Particle = { x: 1, y: 0, z: 1, vx: 0, vy: 0, phase: 0 };
    drawParticles(cv, [near, far]); // far listed last would otherwise win
    expect(cv.glyphs[0][1]).toBe(glowGlyph(1));
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
