import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Fill extends BrowseCommand {
  static override description =
    "Fill an input-like element by snapshot ref, XPath, or selector.";

  static override examples = [
    "browse fill @0-8 'shrey@example.com'",
    "browse fill 'input[name=q]' 'browser automation' --press-enter",
    "browse fill @0-8 'draft text' --session research",
  ];

  static override args = {
    selector: Args.string({
      description: "Snapshot ref such as @0-8, XPath, or selector.",
      required: true,
    }),
    value: Args.string({
      description: "Text value to fill.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    "press-enter": Flags.boolean({
      description: "Press Enter after filling.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Fill);
    await runDriverCommandFromFlags(
      "fill",
      {
        pressEnter: flags["press-enter"],
        selector: args.selector,
        value: args.value,
      },
      flags,
    );
  }
}
