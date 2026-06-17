import { Args, Flags } from "@oclif/core";
import { promises as fs } from "node:fs";

import { BrowseCommand } from "../../base.js";
import { macroFilePath } from "../../lib/macro/store.js";
import { outputJson } from "../../lib/output.js";

export default class MacroDelete extends BrowseCommand {
  static override description = "Delete a saved browse macro.";

  static override examples = [
    "browse macro delete login-flow",
    "browse macro delete login-flow --force",
  ];

  static override args = {
    name: Args.string({
      description: "Macro name to delete.",
      required: true,
    }),
  };

  static override flags = {
    force: Flags.boolean({
      default: false,
      description: "Delete without confirmation.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MacroDelete);
    const file = macroFilePath(args.name);

    if (!flags.force) {
      throw new Error(
        `Refusing to delete macro "${args.name}" without --force.`,
      );
    }

    await fs.unlink(file);
    outputJson({
      deleted: true,
      name: args.name,
    });
  }
}
