import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class NetworkOn extends BrowseCommand {
  static override description =
    "Enable network capture for the active browser session.";

  static override examples = [
    "browse network on",
    "browse network on --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NetworkOn);
    await runDriverCommandFromFlags("network.on", {}, flags);
  }
}
