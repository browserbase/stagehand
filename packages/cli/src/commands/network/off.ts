import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class NetworkOff extends BrowseCommand {
  static override description =
    "Disable network capture for the active browser session.";

  static override examples = [
    "browse network off",
    "browse network off --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NetworkOff);
    await runDriverCommandFromFlags("network.off", {}, flags);
  }
}
