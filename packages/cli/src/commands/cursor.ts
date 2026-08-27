import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Cursor extends BrowseCommand {
  static override description =
    "Enable a visible cursor overlay in the active browser page.";

  static override examples = [
    "browse cursor",
    "browse cursor --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Cursor);
    await runDriverCommandFromFlags("cursor", {}, flags);
  }
}
