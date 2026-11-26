import { c } from "./format.js";

export const BANNER_LINES = [
  "███████╗██╗   ██╗ █████╗ ██╗     ███████╗",
  "██╔════╝██║   ██║██╔══██╗██║     ██╔════╝",
  "█████╗  ██║   ██║███████║██║     ███████╗",
  "██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ╚════██║",
  "███████╗ ╚████╔╝ ██║  ██║███████╗███████║",
  "╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝╚══════╝",
];

export const BANNER_W = BANNER_LINES[0].length;

export function printBanner(): void {
  console.log("");
  for (const line of BANNER_LINES) console.log(`${c.bbBold}${line}${c.reset}`);
  console.log("");
}
