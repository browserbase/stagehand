import { Flags } from "@oclif/core";

import {
  collectionVersionFlag,
  usesCollectionContract,
  outputCollection,
  validateCollectionFlags,
} from "../../lib/collections.js";
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
    ...collectionVersionFlag,
    all: Flags.boolean({
      description:
        "Show all returned skills (all output formats in version 2).",
    }),
    limit: Flags.integer({
      description:
        "Maximum skills: table rows in version 1 (default 25), records in version 2 (default 20).",
      helpValue: "<count>",
      min: 1,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SkillsList);
    if (usesCollectionContract(flags)) validateCollectionFlags(flags);
    const skills = await listCatalogSkills();

    if (usesCollectionContract(flags)) {
      await outputCollection({
        flags,
        source: { kind: "array", complete: true, load: async () => skills },
        table: (items) =>
          outputSkillTable(items, {
            limit: items.length,
            wide: flags.wide,
            footer: false,
          }),
      });
      return;
    }

    if (resolveOutputFormat(flags) === "json") {
      outputJson({ skills });
      return;
    }

    outputSkillTable(skills, {
      limit: flags.all ? skills.length : (flags.limit ?? 25),
      wide: flags.wide,
    });
  }
}
