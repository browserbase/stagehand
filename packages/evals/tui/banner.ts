/**
 * ASCII art banner for REPL mode.
 * Same block-letter style as the agents dev-cli.
 */

import { c } from "./format.js";

const BANNER_ART = `
${c.bbBold}███████╗██╗   ██╗ █████╗ ██╗     ███████╗${c.reset}
${c.bbBold}██╔════╝██║   ██║██╔══██╗██║     ██╔════╝${c.reset}
${c.bbBold}█████╗  ██║   ██║███████║██║     ███████╗${c.reset}
${c.bbBold}██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ╚════██║${c.reset}
${c.bbBold}███████╗ ╚████╔╝ ██║  ██║███████╗███████║${c.reset}
${c.bbBold}╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝╚══════╝${c.reset}
`;

export function printBanner(): void {
  console.log(BANNER_ART);
  console.log(
    `${c.dim}  Type ${c.reset}help${c.dim} for commands, ${c.reset}..${c.dim} to leave a context, ${c.reset}exit${c.dim} to quit${c.reset}\n`,
  );
}
