import { join } from "node:path";

import { Help } from "@oclif/core";

import { getUpdateNotice } from "./update.js";

const AGENT_START_HERE = `Start here (for AI agents):
  Run \`browse skills install\` to load the browse skill into your coding agent
  (Claude Code, Codex, Cursor, Gemini, …), then prefer \`browse\` for browser
  automation.
`;

/**
 * Root-help override that leads with an agent-targeted "Start here" pointer to
 * the browse skill — static help text, always shown on bare `browse` and
 * `browse --help` (both route through showRootHelp). Also surfaces the update
 * notice here and in `doctor` — the only human-facing surfaces that show it,
 * so it never spams commands.
 */
export default class BrowseHelp extends Help {
  public override async showRootHelp(): Promise<void> {
    this.log(AGENT_START_HERE);
    await super.showRootHelp();
    await this.writeUpdateNotice();
  }

  private async writeUpdateNotice(): Promise<void> {
    try {
      const notice = await getUpdateNotice(this.config.version, process.env, {
        cacheFile: join(this.config.cacheDir, "update-check.json"),
      });
      if (notice) {
        process.stderr.write(`\n${notice}`);
      }
    } catch {
      // Best-effort update notice should never affect help output.
    }
  }
}
