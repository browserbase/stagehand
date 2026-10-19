import { Args } from "@oclif/core";
import { promises as fs } from "node:fs";

import { BrowseCommand } from "../../base.js";
import { fail } from "../../lib/errors.js";
import { macroFilePath } from "../../lib/macro/store.js";
import { outputJson } from "../../lib/output.js";

export default class MacroDelete extends BrowseCommand {
  static override description = "Delete a saved browse macro.";

  static override examples = ["browse macro delete login-flow"];

  static override args = {
    name: Args.string({
      description: "Macro name to delete.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MacroDelete);
    const file = macroFilePath(args.name);

    try {
      await fs.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        fail(`Macro "${args.name}" not found.`);
      }
      throw error;
    }

    outputJson({
      deleted: true,
      name: args.name,
    });
  }
}
