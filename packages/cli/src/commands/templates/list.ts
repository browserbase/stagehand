import { Flags } from "@oclif/core";

import {
  collectionVersionFlag,
  collectionLimitFlags,
  usesCollectionContract,
  outputCollection,
  validateCollectionFlags,
  requireCollectionVersion,
} from "../../lib/collections.js";
import { BrowseCommand } from "../../base.js";
import {
  outputFormatFlags,
  outputJson,
  resolveOutputFormat,
} from "../../lib/output.js";
import { listTemplates } from "../../lib/templates/api.js";
import { outputTemplateTable } from "../../lib/templates/output.js";

export default class TemplatesList extends BrowseCommand {
  static override description = "List Browserbase templates.";

  static override examples = [
    "browse templates list",
    'browse templates list --category "Web Automation"',
    "browse templates list --tag Python --source Browserbase",
    "browse templates list --wide",
    "browse templates list --json",
  ];

  static override flags = {
    ...outputFormatFlags,
    ...collectionVersionFlag,
    ...collectionLimitFlags,
    category: Flags.string({
      description: "Filter templates by category.",
      helpValue: "<category>",
    }),
    source: Flags.string({
      description: "Filter templates by source.",
      helpValue: "<source>",
    }),
    tag: Flags.string({
      description: "Filter templates by tag.",
      helpValue: "<tag>",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TemplatesList);
    if (usesCollectionContract(flags)) validateCollectionFlags(flags);
    else requireCollectionVersion(flags, ["limit", "all"]);
    const templates = await listTemplates({
      category: flags.category,
      source: flags.source,
      tag: flags.tag,
    });

    if (usesCollectionContract(flags)) {
      await outputCollection({
        flags,
        source: { kind: "array", complete: true, load: async () => templates },
        table: (items) =>
          outputTemplateTable(items, { wide: flags.wide, footer: false }),
      });
      return;
    }

    if (resolveOutputFormat(flags) === "json") {
      outputJson({ templates });
      return;
    }

    outputTemplateTable(templates, { wide: flags.wide });
  }
}
