import { BrowseCommand } from "../../base.js";
import {
  clipboardScopeNote,
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class ClipboardCut extends BrowseCommand {
  static override description = `Cut the current page selection to the session clipboard.\n\n${clipboardScopeNote}`;

  static override examples = [
    "browse clipboard cut",
    "browse clipboard cut --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ClipboardCut);
    await runDriverCommandFromFlags("clipboard.cut", {}, flags);
  }
}
