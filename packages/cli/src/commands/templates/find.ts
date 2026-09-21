import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  outputFormatFlags,
  outputJson,
  resolveOutputFormat,
} from "../../lib/output.js";
import { getTemplateIfExists, listTemplates } from "../../lib/templates/api.js";
import {
  outputTemplateTable,
  printTemplateDetail,
  templateMatchesQuery,
} from "../../lib/templates/output.js";

export default class TemplatesFind extends BrowseCommand {
  static override description =
    "Find Browserbase templates by slug, title, category, or tag.";

  static override examples = [
    "browse templates find google-trends-keywords",
    "browse templates find amazon",
    "browse templates find Python --wide",
    "browse templates find Python --json",
  ];

  static override args = {
    query: Args.string({
      description: "Template slug or search query.",
      required: true,
    }),
  };

  static override flags = {
    ...outputFormatFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplatesFind);
    const exactTemplate = await getTemplateIfExists(args.query);
    const outputFormat = resolveOutputFormat(flags);

    if (exactTemplate) {
      if (outputFormat === "json") {
        outputJson({ query: args.query, templates: [exactTemplate] });
        return;
      }

      printTemplateDetail(exactTemplate);
      return;
    }

    const templates = await listTemplates();
    const matches = templates.filter((template) =>
      templateMatchesQuery(template, args.query),
    );

    if (outputFormat === "json") {
      outputJson({ query: args.query, templates: matches });
      return;
    }

    outputTemplateTable(matches, {
      heading: `Templates matching "${args.query}"`,
      wide: flags.wide,
    });
  }
}
