import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class ClipboardWrite extends BrowseCommand {
  static override description =
    "Write text to the browser clipboard for the active page.";

  static override examples = [
    "browse clipboard write 'hello world'",
    "browse clipboard write 'seed text' --session research",
  ];

  static override args = {
    text: Args.string({
      description: "Text to write to the clipboard.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ClipboardWrite);
    await runDriverCommandFromFlags(
      "clipboard.write",
      { text: args.text },
      flags,
    );
  }
}
