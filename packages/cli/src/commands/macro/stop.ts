import { BrowseCommand } from "../../base.js";
import { stopMacroRecording } from "../../lib/macro/recording.js";
import { outputJson } from "../../lib/output.js";

export default class MacroStop extends BrowseCommand {
  static override description = "Stop the active macro recording and save it.";

  static override examples = ["browse macro stop"];

  async run(): Promise<void> {
    const macro = await stopMacroRecording();
    outputJson({
      createdAt: macro.createdAt,
      message: `Saved macro "${macro.name}" with ${macro.steps.length} step(s).`,
      name: macro.name,
      steps: macro.steps.length,
    });
  }
}
