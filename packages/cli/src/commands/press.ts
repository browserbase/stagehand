import { Args } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Press extends BrowseCommand {
  static override aliases = ["key"];
  static override description = "Press a keyboard key in the active page.";

  static override examples = [
    "browse press Enter",
    "browse press Escape",
    "browse key Meta+K",
  ];

  static override args = {
    key: Args.string({
      description: "Key name or key chord, for example Enter, Escape, Meta+K.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Press);
    await runDriverCommandFromFlags("key", { key: args.key }, flags);
  }
}
