import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { captureLinkOpened } from "../lib/link-telemetry.js";
import { openUrl } from "../lib/open-url.js";
import { getGitHubIssuesUrl } from "../lib/support-links.js";

export default class Issues extends BrowseCommand {
  static override aliases = ["bug"];

  static override description =
    "Open the Stagehand GitHub issues page in your system browser (not a browse session).";

  static override examples = ["browse issues", "browse issues --no-open", "browse bug"];

  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the issues URL without opening a browser.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Issues);
    const noOpen = flags["no-open"];

    const url = getGitHubIssuesUrl("issues_command");
    const result = openUrl(url, { noOpen });

    if (result.attempted && result.success) {
      this.log(`Opening ${url}`);
    } else {
      this.log(url);
    }

    this.log(
      "Report bugs, request features, or browse existing issues for Stagehand and the Browse CLI.",
    );

    await captureLinkOpened({
      target: "github_issues",
      source: "issues_command",
      opened: result.attempted,
      browser_open_succeeded: result.success,
    });
  }
}
