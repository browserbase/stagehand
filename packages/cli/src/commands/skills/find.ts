import { Args, Flags } from "@oclif/core";

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
  exactSkillMatch,
  listCatalogSkills,
  outputSkillTable,
  printSkillDetail,
  prioritizeExactSkillMatch,
} from "../../lib/skills/catalog.js";

export default class SkillsFind extends BrowseCommand {
  static override description =
    "Find Browse.sh catalog skills by slug, domain, title, description, category, alias, or tag.";

  static override examples = [
    "browse skills find yelp",
    "browse skills find reviews",
    "browse skills find yelp.com/extract-reviews",
    "browse skills find travel --limit 5",
    'browse skills find "restaurant reviews" --json',
  ];

  static override args = {
    query: Args.string({
      required: true,
      description: "Skill slug or search query.",
    }),
  };

  static override flags = {
    ...outputFormatFlags,
    ...collectionVersionFlag,
    all: Flags.boolean({
      description:
        "Show all matching skills (all output formats in version 2).",
    }),
    limit: Flags.integer({
      description:
        "Maximum matches: table rows in version 1 (default 25), records in version 2 (default 20).",
      helpValue: "<count>",
      min: 1,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillsFind);
    if (usesCollectionContract(flags)) validateCollectionFlags(flags);
    const skills = prioritizeExactSkillMatch(
      await listCatalogSkills({ query: args.query }),
      args.query,
    );

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

    const outputFormat = resolveOutputFormat(flags);
    if (outputFormat === "json") {
      outputJson({ query: args.query, skills });
      return;
    }

    const exactMatch = exactSkillMatch(skills, args.query);
    if (skills.length === 1 && exactMatch) {
      printSkillDetail(exactMatch);
      return;
    }

    outputSkillTable(skills, {
      heading: `Skills matching "${args.query}"`,
      limit: flags.all ? skills.length : (flags.limit ?? 25),
      wide: flags.wide,
    });
  }
}
