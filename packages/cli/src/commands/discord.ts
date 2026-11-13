import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { openUrl } from "../lib/open-url.js";
import { DISCORD_INVITE_URL } from "../lib/support-links.js";

export default class Discord extends BrowseCommand {
  static override description =
    "Open the Stagehand Discord in your system browser (not a browse session).";

  static override examples = ["browse discord", "browse discord --no-open"];

  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the invite URL without opening a browser.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Discord);
    const noOpen = flags["no-open"];

    const result = await openUrl(DISCORD_INVITE_URL, { noOpen });

    if (result.attempted && result.success) {
      this.log(`Opening ${DISCORD_INVITE_URL}`);
    } else {
      this.log(DISCORD_INVITE_URL);
    }

    this.log(
      "Join our Discord community to contribute to Stagehand and the Browse CLI, request features, and share feedback!",
    );
  }
}
