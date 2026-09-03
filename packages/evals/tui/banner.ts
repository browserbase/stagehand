/**
 * ASCII art banner for REPL mode and the welcome flows.
 *
 * Solid brand green everywhere (static in the REPL, revealed row-by-row
 * with a single highlight sweep in the welcome flows). The tip line that
 * used to live here is `printTipLine()` in tui/welcome.ts.
 */

import { c } from "./format.js";
import {
  BRAND,
  canAnimateInPlace,
  center,
  gradientText,
  LiveBlock,
  sleep,
  typeline,
  type SkipSignal,
} from "./wizardAnim.js";

const BANNER_LINES = [
  "███████╗██╗   ██╗ █████╗ ██╗     ███████╗",
  "██╔════╝██║   ██║██╔══██╗██║     ██╔════╝",
  "█████╗  ██║   ██║███████║██║     ███████╗",
  "██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ╚════██║",
  "███████╗ ╚████╔╝ ██║  ██║███████╗███████║",
  "╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝╚══════╝",
];

/** Banner glyph width (every row is the same visible length). */
export const BANNER_W = BANNER_LINES[0].length;

export function printBanner(): void {
  console.log("");
  for (const line of BANNER_LINES) console.log(`${c.bbBold}${line}${c.reset}`);
  console.log("");
}

// ─── Animated banner reveal (used by the welcome flows) ──────────────
// Rows paint top-down in brand green, then a mint highlight band sweeps
// across the mark once — the "deluxe entry point" signal.

const FRAME_MS = 55;
const SHIMMER_FRAME_MS = 32;
const SHIMMER_STEP = 3;
const SHIMMER_HALF_WIDTH = 7;

function bannerRows(highlight?: { center: number; halfWidth: number }): string[] {
  return BANNER_LINES.map((line) => gradientText(line, BRAND, BRAND, { bold: true, highlight }));
}

export async function revealBanner(
  opts: { signal?: SkipSignal; tagline?: string; hint?: string; shimmer?: boolean } = {},
): Promise<void> {
  const { signal, tagline, hint, shimmer = true } = opts;
  if (!process.stdout.isTTY) {
    printBanner();
    if (tagline) console.log(center(tagline, BANNER_W));
    return;
  }
  process.stdout.write("\n");
  const rows = bannerRows();
  for (const row of rows) {
    process.stdout.write(`${row}\n`);
    await sleep(FRAME_MS, signal);
  }

  if (shimmer && canAnimateInPlace() && !signal?.cancelled) {
    const block = new LiveBlock();
    block.adopt(rows.length);
    for (
      let x = -SHIMMER_HALF_WIDTH;
      x <= BANNER_W + SHIMMER_HALF_WIDTH && !signal?.cancelled;
      x += SHIMMER_STEP
    ) {
      block.paint(bannerRows({ center: x, halfWidth: SHIMMER_HALF_WIDTH }));
      await sleep(SHIMMER_FRAME_MS, signal);
    }
    block.paint(rows);
  }

  if (tagline) {
    // The one typewriter line in any welcome flow — body copy elsewhere
    // renders instantly so the user never waits on text they've read.
    process.stdout.write("\n");
    await sleep(120, signal);
    await typeline(center(`${c.dim}${tagline}${c.reset}`, BANNER_W), {
      msPerChar: 16,
      signal,
    });
  }
  if (hint) {
    process.stdout.write(center(`${c.dim}${hint}${c.reset}`, BANNER_W) + "\n");
  }
  process.stdout.write("\n");
}
