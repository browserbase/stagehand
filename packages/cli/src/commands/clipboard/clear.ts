import { BrowseCommand } from "../../base.js";
import {
  clipboardScopeNote,
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class ClipboardClear extends BrowseCommand {
  static override description = `Clear the clipboard for the active browser session.\n\n${clipboardScopeNote}`;

  static override examples = [
    "browse clipboard clear",
    "browse clipboard clear --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ClipboardClear);
    await runDriverCommandFromFlags("clipboard.clear", {}, flags);
  }
}
