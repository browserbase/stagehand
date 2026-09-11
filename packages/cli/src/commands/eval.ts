import { Args } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Eval extends BrowseCommand {
  static override description =
    "Evaluate JavaScript in the active browser page.";

  static override examples = [
    "browse eval 'document.title'",
    "browse eval 'document.querySelector(\"h1\")?.textContent'",
    "browse eval 'window.location.href' --session research",
  ];

  static override args = {
    expression: Args.string({
      description: "JavaScript expression to evaluate.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Eval);
    await runDriverCommandFromFlags(
      "eval",
      { expression: args.expression },
      flags,
    );
  }
}
