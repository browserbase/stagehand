import { Args } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Click extends BrowseCommand {
  static override description =
    "Click an element by snapshot ref, XPath, or selector. Use `browse mouse click` for raw coordinates.";

  static override examples = [
    "browse click @0-12",
    "browse click 'button[type=submit]'",
    "browse click @0-12 --session research",
  ];

  static override args = {
    selector: Args.string({
      description: "Snapshot ref such as @0-12, XPath, or selector.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Click);
    await runDriverCommandFromFlags(
      "click",
      { selector: args.selector },
      flags,
    );
  }
}
