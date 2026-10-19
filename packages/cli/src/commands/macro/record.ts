import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { startMacroRecording } from "../../lib/macro/recording.js";
import { outputJson } from "../../lib/output.js";

export default class MacroRecord extends BrowseCommand {
  static override description =
    "Start recording browse driver commands into a named macro.";

  static override examples = [
    "browse macro record login-flow",
    "browse macro record checkout --session research",
  ];

  static override args = {
    name: Args.string({
      description: "Macro name to create.",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MacroRecord);
    await startMacroRecording(args.name);
    outputJson({
      message: `Recording macro "${args.name}". Run browse commands, then browse macro stop.`,
      name: args.name,
      recording: true,
    });
  }
}
