import { Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class ClipboardPaste extends BrowseCommand {
  static override description =
    "Paste clipboard text into the focused field on the active page.";

  static override examples = [
    "browse clipboard paste",
    "browse clipboard paste --shortcut Control+V",
  ];

  static override flags = {
    ...driverCommandFlags,
    shortcut: Flags.string({
      description: "Keyboard shortcut to trigger paste.",
      helpValue: "<shortcut>",
      options: ["ControlOrMeta+V", "Meta+V", "Control+V"],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ClipboardPaste);
    await runDriverCommandFromFlags(
      "clipboard.paste",
      { shortcut: flags.shortcut },
      flags,
    );
  }
}
