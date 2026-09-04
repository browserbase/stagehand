/**
 * The Stagehand mark, from geometry.
 *
 * The icon is a green square with an S-shaped hole: a chamfered white block
 * with two thin green slits cutting in from opposite sides (that's what makes
 * it read as an S). Thin slits die when a bitmap is sampled, so this module
 * rasterizes the SVG contour itself — supersampled coverage per pixel, two
 * pixels per cell via half-blocks (fg = top, bg = bottom) — at whatever size
 * the caller asks for, snapped to the pixel grid so the slits stay crisp.
 */

import { Canvas, mixRgb, PALETTE } from "../fx.js";
import type { RGB } from "../wizardAnim.js";

/** Vertices of the S cutout in the SVG's 200×200 unit square (assets/brand/stagehand-logo.svg). */
const S_CONTOUR: ReadonlyArray<readonly [number, number]> = [
  [57.0107, 67.5469],
  [57.0107, 98.7354],
  [70.9932, 112],
  [113.995, 112],
  [113.995, 119],
  [57.0107, 119],
  [57.0107, 147.945],
  [128.824, 147.945],
  [147.003, 130.618],
  [147.003, 99.4297],
  [130.999, 84],
  [90.0176, 84],
  [90.0176, 77],
  [147.003, 77],
  [147.003, 52.2998],
  [72.3916, 52.2988],
];
const UNITS = 200;

export type MarkRaster = {
  /** Square pixel grid, `px` per side; each value is the white (cutout) coverage 0→1. */
  px: number;
  cover: Float32Array;
};

/**
 * Rasterize the mark at `px` pixels per side.
 *
 * Vertices are snapped to integer pixel edges first, then pixel centers are
 * classified — binary, no anti-aliasing. That is deliberate: the two slits
 * that make the S are ~1.1px at any terminal size, and supersampling turns
 * them into fuzzy half-coverage bands; snapping guarantees each slit is
 * exactly one crisp pixel row (one half-block) and every edge sits on a cell
 * boundary. Rounding keeps both slits open for every px ≥ 24.
 */
export function rasterizeMark(px: number): MarkRaster {
  const k = px / UNITS;
  const snapped = S_CONTOUR.map(([x, y]) => [Math.round(x * k), Math.round(y * k)] as const);
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (let i = 0, j = snapped.length - 1; i < snapped.length; j = i++) {
      const [xi, yi] = snapped[i];
      const [xj, yj] = snapped[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const cover = new Float32Array(px * px);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) cover[y * px + x] = inside(x + 0.5, y + 0.5) ? 1 : 0;
  }
  return { px, cover };
}

export type MarkPaint = {
  /** Overall fade from the dark, 0→1. */
  alpha: number;
  /** How much of the cutout has been carved, top→bottom, 0→1 (1 = fully revealed). */
  carve: number;
  /** Column of a passing light, in cell space relative to the mark's left edge, or null. */
  sweepX: number | null;
  /** Extra lift of the white toward mint (breathing), 0→1. */
  glow: number;
};

/** Cells the mark occupies: `rows` tall, `2 * rows` wide (half-block pixels are 1×2). */
export function markSize(rows: number): { cols: number; rows: number } {
  return { cols: rows * 2, rows };
}

/**
 * Paint the mark with its top-left cell at (x0, y0). Each cell shows two
 * pixels; a cell whose two pixels match collapses to a full block.
 */
export function paintMark(
  cv: Canvas,
  raster: MarkRaster,
  x0: number,
  y0: number,
  p: MarkPaint,
): void {
  const { px, cover } = raster;
  const rows = px / 2;
  const green = mixRgb(PALETTE.void, PALETTE.brand, p.alpha);
  const white = mixRgb(mixRgb(PALETTE.void, PALETTE.white, p.alpha), PALETTE.mint, p.glow * 0.5);
  const carveY = p.carve * px; // in pixels
  const pixel = (x: number, y: number): RGB => {
    let c = cover[y * px + x];
    // Carve: pixels below the carve line are still solid green; the row at the
    // line is partially revealed so the edge moves smoothly.
    const reveal = Math.max(0, Math.min(1, carveY - y));
    c *= reveal;
    let color = mixRgb(green, white, c);
    // Bright leading edge on the carve line.
    if (p.carve < 1 && Math.abs(y - carveY) < 1.5 && c > 0.05) {
      color = mixRgb(color, PALETTE.mint, 0.5 * (1 - Math.abs(y - carveY) / 1.5));
    }
    if (p.sweepX !== null) {
      const d = Math.abs(x - p.sweepX) / 5;
      if (d < 1) color = mixRgb(color, PALETTE.white, (1 - d) * 0.35);
    }
    return color;
  };
  for (let ry = 0; ry < rows; ry++) {
    for (let x = 0; x < px; x++) {
      const top = pixel(x, ry * 2);
      const bottom = pixel(x, ry * 2 + 1);
      const same = top[0] === bottom[0] && top[1] === bottom[1] && top[2] === bottom[2];
      if (same) cv.put(x0 + x, y0 + ry, "█", top);
      else cv.put(x0 + x, y0 + ry, "▀", top, bottom);
    }
  }
}
