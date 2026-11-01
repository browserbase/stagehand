import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  resolveTargetForCommand,
  type DriverFlags,
} from "../../lib/driver/command-cli.js";
import { sessionName } from "../../lib/driver/flags.js";
import { replayMacro } from "../../lib/macro/replay.js";
import { outputJson } from "../../lib/output.js";

export default class MacroRun extends BrowseCommand {
  static override description =
    "Replay a saved macro in the active browse driver session.";

  static override examples = [
    "browse macro run login-flow",
    "browse macro run checkout --session research --delay 250",
  ];

  static override args = {
    name: Args.string({
      description: "Macro name to replay.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    delay: Flags.integer({
      default: 0,
      description: "Delay in milliseconds between macro steps.",
      helpValue: "<ms>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MacroRun);
    const session = sessionName(flags.session);
    const target = await resolveTargetForCommand(session, flags as DriverFlags);
    const { macro, results } = await replayMacro({
      delayMs: flags.delay,
      name: args.name,
      session,
      target,
    });

    outputJson({
      name: macro.name,
      results,
      steps: macro.steps.length,
    });
  }
}
