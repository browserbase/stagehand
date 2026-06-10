import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class NetworkClear extends BrowseCommand {
  static override description =
    "Clear captured network request directories for the active browser session.";

  static override examples = [
    "browse network clear",
    "browse network clear --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(NetworkClear);
    await runDriverCommandFromFlags("network.clear", {}, flags);
  }
}
