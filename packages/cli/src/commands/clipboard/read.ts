import { BrowseCommand } from "../../base.js";
import {
  clipboardScopeNote,
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class ClipboardRead extends BrowseCommand {
  static override description = `Read text from the session clipboard.\n\n${clipboardScopeNote}`;

  static override examples = [
    "browse clipboard read",
    "browse clipboard read --session research",
  ];

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ClipboardRead);
    await runDriverCommandFromFlags("clipboard.read", {}, flags);
  }
}
