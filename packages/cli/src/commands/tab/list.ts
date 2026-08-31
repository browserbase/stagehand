import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class TabList extends BrowseCommand {
  static override description =
    "List tabs in the active browser session, including stable targetIds.";

  static override examples = [
    "browse tab list",
    "browse tab list --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TabList);
    await runDriverCommandFromFlags("tab.list", {}, flags);
  }
}
