import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { outputJson } from "../../lib/output.js";
import { getTemplate, type TemplateLanguage } from "../../lib/templates/api.js";
import { cloneTemplate } from "../../lib/templates/scaffold.js";

const languages = ["typescript", "python"] as const;

export default class TemplatesClone extends BrowseCommand {
  static override description =
    "Scaffold a ready-to-run project from a Browserbase template.";

  static override examples = [
    "browse templates clone google-trends-keywords",
    "browse templates clone amazon-product-scraping --language python ./my-scraper",
    "browse templates clone dynamic-form-filling ./form-bot --language typescript",
  ];

  static override args = {
    slug: Args.string({
      description: "Template slug.",
      required: true,
    }),
    path: Args.string({
      description: "Destination directory. Defaults to the template slug.",
      required: false,
    }),
  };

  static override flags = {
    json: Flags.boolean({
      description: "Print clone result as JSON.",
    }),
    language: Flags.string({
      description:
        "Template language. Defaults to TypeScript when available, then Python.",
      helpValue: "<language>",
      options: [...languages],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TemplatesClone);
    const template = await getTemplate(args.slug);
    const result = await cloneTemplate({
      destination: args.path,
      language: flags.language as TemplateLanguage | undefined,
      quiet: flags.json,
      template,
    });

    if (flags.json) {
      outputJson({
        ok: true,
        destination: result.destination,
        language: result.language,
        nextSteps: result.nextSteps,
        slug: template.slug,
      });
      return;
    }

    console.log(`\nTemplate scaffolded to ${result.destination}`);
    console.log("\nNext steps:");
    for (const step of result.nextSteps) {
      console.log(`  ${step}`);
    }
  }
}
