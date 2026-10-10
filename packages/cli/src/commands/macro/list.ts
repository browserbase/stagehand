import { BrowseCommand } from "../../base.js";
import { listMacroNames } from "../../lib/macro/store.js";
import { getActiveRecordingName } from "../../lib/macro/recording.js";
import { outputJson } from "../../lib/output.js";

export default class MacroList extends BrowseCommand {
  static override description = "List saved browse macros.";

  static override examples = ["browse macro list"];

  async run(): Promise<void> {
    const [macros, recording] = await Promise.all([
      listMacroNames(),
      getActiveRecordingName(),
    ]);

    outputJson({
      macros,
      recording,
    });
  }
}
