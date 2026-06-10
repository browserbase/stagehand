import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Snapshot extends BrowseCommand {
  static override description =
    "Print the active page accessibility snapshot and cache refs for element commands.";

  static override examples = [
    "browse snapshot",
    "browse snapshot --compact",
    "browse snapshot --filter submit",
    "browse snapshot --max-depth 4",
  ];

  static override flags = {
    ...driverCommandFlags,
    compact: Flags.boolean({
      description: "Print only the formatted tree, without ref maps.",
    }),
    filter: Flags.string({
      description:
        "Filter output lines by text or /regex/ while preserving matching ancestors.",
      helpValue: "<text|/regex/>",
    }),
    "max-depth": Flags.integer({
      description: "Trim snapshot output deeper than this tree depth.",
      helpValue: "<depth>",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Snapshot);
    await runDriverCommandFromFlags(
      "snapshot",
      {
        compact: flags.compact,
        filter: flags.filter,
        maxDepth: flags["max-depth"],
      },
      flags,
    );
  }
}
