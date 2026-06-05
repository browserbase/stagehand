import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class NetworkPath extends BrowseCommand {
  static override description =
    "Print the network capture directory for the active browser session.";

  static override examples = [
    "browse network path",
    "browse network path --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NetworkPath);
    await runDriverCommandFromFlags("network.path", {}, flags);
  }
}
