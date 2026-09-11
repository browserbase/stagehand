import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
  timeoutMsFlag,
  waitUntilFlag,
} from "../lib/driver/command-cli.js";

export default class Reload extends BrowseCommand {
  static override description = "Reload the active browser page.";

  static override examples = [
    "browse reload",
    "browse reload --session research",
    "browse reload --wait networkidle --timeout 45000",
  ];

  static override flags = {
    ...driverCommandFlags,
    timeout: timeoutMsFlag,
    wait: waitUntilFlag,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Reload);
    await runDriverCommandFromFlags(
      "reload",
      { timeoutMs: flags.timeout, waitUntil: flags.wait },
      flags,
    );
  }
}
