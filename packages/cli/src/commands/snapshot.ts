import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Snapshot extends BrowseCommand {
  static override description =
    "Print the active page accessibility snapshot and cache refs for element commands. Lean by default (formatted tree only); pass --full to also include the ref maps (xpathMap, urlMap). The ref maps are always cached for element commands regardless, and can be printed on demand with `browse refs`.";

  static override examples = [
    "browse snapshot",
    "browse snapshot --full",
    "browse snapshot --filter submit",
    "browse snapshot --max-depth 4",
  ];

  static override flags = {
    ...driverCommandFlags,
    full: Flags.boolean({
      description:
        "Include the ref maps (xpathMap, urlMap) in addition to the formatted tree. Restores the pre-lean default output.",
    }),
    compact: Flags.boolean({
      description:
        "Deprecated: snapshots are lean by default, so this flag has no effect. Use --full to include the ref maps.",
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
    // `--compact` is now the default. Keep accepting it as a no-op alias so
    // existing callers don't break, but nudge interactive users toward --full.
    // Warn on stderr only, gated on a TTY, so agents parsing stdout JSON (or
    // capturing stderr) get no extra noise.
    if (flags.compact && process.stderr.isTTY) {
      this.warn(
        "`--compact` is deprecated: `browse snapshot` is lean by default. Use `--full` to include the ref maps.",
      );
    }
    await runDriverCommandFromFlags(
      "snapshot",
      {
        // Lean (no ref maps) unless --full is requested.
        compact: !flags.full,
        filter: flags.filter,
        maxDepth: flags["max-depth"],
      },
      flags,
    );
  }
}
