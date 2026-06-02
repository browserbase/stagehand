import { Args, Flags } from "@oclif/core";

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
    all: Flags.boolean({
      description: "Show all matching skills in table output.",
    }),
    limit: Flags.integer({
      default: 25,
      description: "Maximum matching skills to show in table output.",
      helpValue: "<count>",
      min: 1,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillsFind);
    const skills = prioritizeExactSkillMatch(
      await listCatalogSkills({ query: args.query }),
      args.query,
    );

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
      limit: flags.all ? skills.length : flags.limit,
      wide: flags.wide,
    });
  }
}
