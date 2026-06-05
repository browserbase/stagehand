import { BrowseCommand } from "../../base.js";
import { installBundledCliSkill } from "../../lib/skills/install.js";

export default class SkillsInstall extends BrowseCommand {
  static override description = "Install the bundled browse CLI skill.";

  static override examples = ["browse skills install"];

  async run(): Promise<void> {
    const exitCode = await installBundledCliSkill();
    if (exitCode !== 0) {
      this.exit(exitCode);
    }
  }
}
