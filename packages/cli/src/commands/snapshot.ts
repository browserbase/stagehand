import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Snapshot extends BrowseCommand {
  static override description =
    "Print the active page accessibility snapshot and cache refs for element commands. Pass --full to also include the ref maps (xpathMap, urlMap), or run `browse refs` to print them.";

  static override examples = [
    "browse snapshot",
    "browse snapshot --full",
    "browse snapshot --filter submit",
    "browse snapshot --max-depth 4",
  ];

  static override flags = {
    ...driverCommandFlags,
    full: Flags.boolean({
      description: "Also include the ref maps (xpathMap, urlMap).",
    }),
    compact: Flags.boolean({
      description:
        "Deprecated and has no effect; use --full to include the ref maps.",
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
    if (flags.compact && process.stderr.isTTY) {
      this.warn(
        "`--compact` is deprecated and has no effect; use `--full` to include the ref maps.",
      );
    }
    await runDriverCommandFromFlags(
      "snapshot",
      {
        full: flags.full,
        filter: flags.filter,
        maxDepth: flags["max-depth"],
      },
      flags,
    );
  }
}
