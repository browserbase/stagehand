import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { loadMacro } from "../../lib/macro/store.js";
import { outputJson } from "../../lib/output.js";

export default class MacroShow extends BrowseCommand {
  static override description = "Show the steps in a saved browse macro.";

  static override examples = ["browse macro show login-flow"];

  static override args = {
    name: Args.string({
      description: "Macro name to inspect.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MacroShow);
    outputJson(await loadMacro(args.name));
  }
}
