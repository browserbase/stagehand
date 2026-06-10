import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
  timeoutMsFlag,
  waitUntilFlag,
} from "../lib/driver/command-cli.js";

export default class Forward extends BrowseCommand {
  static override description = "Navigate the active browser page forward.";

  static override examples = [
    "browse forward",
    "browse forward --session research",
    "browse forward --wait domcontentloaded",
  ];

  static override flags = {
    ...driverCommandFlags,
    timeout: timeoutMsFlag,
    wait: waitUntilFlag,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Forward);
    await runDriverCommandFromFlags(
      "forward",
      { timeoutMs: flags.timeout, waitUntil: flags.wait },
      flags,
    );
  }
}
