/**
 * ASCII art banner (figlet ANSI Shadow). `printBanner` is the REPL's static
 * header; the welcome intro animates the same glyphs (see welcome/boot.ts).
 */

import { c } from "./format.js";

export const BANNER_LINES = [
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
