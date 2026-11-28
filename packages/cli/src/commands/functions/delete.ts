import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { deleteFunction } from "../../lib/functions/delete.js";

export default class FunctionsDelete extends BrowseCommand {
  static override description = "Delete a deployed Browserbase Function.";

  static override examples = [
    "browse functions delete <function-id>",
    "browse functions delete 7b6e1c42-8d93-4a15-b2f0-9c6d3e8a5041",
  ];

  static override args = {
    functionId: Args.string({
      description: "Function ID to delete.",
      required: true,
    }),
  };

  static override flags = {
    "api-key": Flags.string({
      description: "Override the Browserbase API key.",
      helpValue: "<apiKey>",
    }),
    "base-url": Flags.string({
      aliases: ["api-url"],
      char: "u",
      description: "Override the Browserbase API base URL.",
      helpValue: "<baseUrl>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionsDelete);
    await deleteFunction({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      functionId: args.functionId,
    });
  }
}
