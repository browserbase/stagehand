import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Highlight extends BrowseCommand {
  static override description =
    "Highlight an element by snapshot ref, XPath, or selector.";

  static override examples = [
    "browse highlight @0-12",
    "browse highlight 'button[type=submit]' --duration 1000",
    "browse highlight @0-12 --session research",
  ];

  static override args = {
    selector: Args.string({
      description: "Snapshot ref such as @0-12, XPath, or selector.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    duration: Flags.integer({
      default: 2000,
      description: "Highlight duration in milliseconds.",
      helpValue: "<ms>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Highlight);
    await runDriverCommandFromFlags(
      "highlight",
      { durationMs: flags.duration, selector: args.selector },
      flags,
    );
  }
}
