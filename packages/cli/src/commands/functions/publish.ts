import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { publishFunction } from "../../lib/functions/publish.js";

export default class FunctionsPublish extends BrowseCommand {
  static override description =
    "Package and upload a Browserbase Function build.";

  static override examples = [
    "browse functions publish index.ts --dry-run",
    "browse functions publish index.ts",
  ];

  static override args = {
    entrypoint: Args.string({
      description: "Function entrypoint file.",
      required: true,
    }),
  };

  static override flags = {
    "api-key": Flags.string({
      description: "Override the Browserbase API key.",
      helpValue: "<apiKey>",
    }),
    "base-url": Flags.string({
      description: "Override the Browserbase API base URL.",
      helpValue: "<baseUrl>",
    }),
    "dry-run": Flags.boolean({
      description: "Show what would be published without uploading.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionsPublish);
    await publishFunction({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      dryRun: flags["dry-run"] ?? false,
      entrypoint: args.entrypoint,
    });
  }
}
