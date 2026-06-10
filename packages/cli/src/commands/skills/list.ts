import { Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  outputFormatFlags,
  outputJson,
  resolveOutputFormat,
} from "../../lib/output.js";
import {
  listCatalogSkills,
  outputSkillTable,
} from "../../lib/skills/catalog.js";

export default class SkillsList extends BrowseCommand {
  static override description = "List Browse.sh catalog skills.";

  static override examples = [
    "browse skills list",
    "browse skills list --limit 10",
    "browse skills list --all",
    "browse skills list --json",
  ];

  static override flags = {
    ...outputFormatFlags,
    all: Flags.boolean({
      description: "Show all returned skills in table output.",
    }),
    limit: Flags.integer({
      default: 25,
      description: "Maximum skills to show in table output.",
      helpValue: "<count>",
      min: 1,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsList);
    const skills = await listCatalogSkills();

    if (resolveOutputFormat(flags) === "json") {
      outputJson({ skills });
      return;
    }

    outputSkillTable(skills, {
      limit: flags.all ? skills.length : flags.limit,
      wide: flags.wide,
    });
  }
}
