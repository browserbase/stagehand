import { BrowseCommand } from "../../base.js";
import {
  clipboardScopeNote,
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class ClipboardCopy extends BrowseCommand {
  static override description = `Copy the current page selection to the session clipboard.\n\n${clipboardScopeNote}`;

  static override examples = [
    "browse clipboard copy",
    "browse clipboard copy --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ClipboardCopy);
    await runDriverCommandFromFlags("clipboard.copy", {}, flags);
  }
}
