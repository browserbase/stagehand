import { Args } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Is extends BrowseCommand {
  static override description =
    "Check element state by snapshot ref, XPath, or selector.";

  static override examples = [
    "browse is visible @0-12",
    "browse is checked 'input[type=checkbox]'",
    "browse is visible @0-12 --session research",
  ];

  static override args = {
    check: Args.string({
      description: "State to check.",
      options: ["visible", "checked"],
      required: true,
    }),
    selector: Args.string({
      description: "Snapshot ref, XPath, or selector.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Is);
    await runDriverCommandFromFlags(
      "is",
      { check: args.check, selector: args.selector },
      flags,
    );
  }
}
