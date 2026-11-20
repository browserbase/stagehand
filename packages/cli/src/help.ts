import { Help } from "@oclif/core";

import { captureHelpLinksShown } from "./lib/link-telemetry.js";
import { DISCORD_INVITE_URL, getGitHubIssuesUrl } from "./lib/support-links.js";

// Custom root-help formatter so `browse --help` (and bare `browse`) lead with
// a short block pointing agents at the bundled skill, ahead of oclif's
// auto-generated VERSION/USAGE/DESCRIPTION/COMMANDS sections. Only the root
// help view is customized -- individual `browse <command> --help` views are
// unaffected.
const AGENT_HEADER = `Start here (for AI agents):
  browse skills show

  The bundled skill ships with the CLI (always version-matched) and covers
  workflows, session management, and common failure recovery. Prefer it over
  guessing commands from flag docs alone.
`;

function buildHelpFooter(): string {
  return `
COMMUNITY
  Discord: ${DISCORD_INVITE_URL}
  Report a bug: ${getGitHubIssuesUrl("help_footer")}
`;
}

export default class BrowseHelp extends Help {
  override async showRootHelp(): Promise<void> {
    this.log(AGENT_HEADER);
    await super.showRootHelp();
    this.log(buildHelpFooter());

    await captureHelpLinksShown({
      source: "help_footer",
      result_code: null,
      error_type: null,
    });
  }
}
