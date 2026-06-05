import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Refs extends BrowseCommand {
  static override description =
    "Show refs cached from the last browse snapshot in this session.";

  static override examples = ["browse refs", "browse refs --session research"];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Refs);
    await runDriverCommandFromFlags("refs", {}, flags);
  }
}
