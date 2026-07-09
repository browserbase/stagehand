import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BrowseCommand } from "../../base.js";
import { fail } from "../../lib/errors.js";
import { bundledCliSkillPath } from "../../lib/skills/install.js";

export default class SkillsShow extends BrowseCommand {
  static override description =
    "Print the bundled browse skill (usage patterns, workflows, gotchas) to stdout. Run before using browse in an agent.";

  static override examples = ["browse skills show"];

  async run(): Promise<void> {
    const skillMdPath = join(bundledCliSkillPath(), "SKILL.md");

    let contents: string;
    try {
      contents = readFileSync(skillMdPath, "utf8");
    } catch (error) {
      fail(
        `Could not read the bundled browse skill (SKILL.md): ${(error as Error).message}`,
        1,
        { resultCode: "skill_show_missing" },
      );
    }

    this.log(contents);
  }
}
