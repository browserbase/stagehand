import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
  timeoutMsFlag,
} from "../lib/driver/command-cli.js";

export default class Wait extends BrowseCommand {
  static override description =
    "Wait for a load state, selector state, or timeout in the active page.";

  static override examples = [
    "browse wait load",
    "browse wait load networkidle --timeout 45000",
    "browse wait selector @0-12 --state visible",
    "browse wait timeout 1000",
  ];

  static override args = {
    type: Args.string({
      description: "Wait type.",
      options: ["load", "selector", "timeout"],
      required: true,
    }),
    arg: Args.string({
      description:
        "Load state, selector, or timeout milliseconds depending on wait type.",
      required: false,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    state: Flags.string({
      default: "visible",
      description: "Selector state to wait for.",
      options: ["attached", "detached", "hidden", "visible"],
    }),
    timeout: timeoutMsFlag,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Wait);
    await runDriverCommandFromFlags(
      "wait",
      {
        arg: args.arg,
        state: flags.state,
        timeoutMs: flags.timeout,
        type: args.type,
      },
      flags,
    );
  }
}
