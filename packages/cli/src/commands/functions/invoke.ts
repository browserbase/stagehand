import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { invokeFunction } from "../../lib/functions/invoke.js";

export default class FunctionsInvoke extends BrowseCommand {
  static override description =
    "Invoke a deployed Browserbase Function or check invocation status.";

  static override examples = [
    `browse functions invoke <function-id> --params '{"url":"https://example.com"}'`,
    "browse functions invoke <function-id> --no-wait",
    "browse functions invoke --check-status <invocation-id>",
  ];

  static override args = {
    functionId: Args.string({
      description: "Function ID to invoke.",
      required: false,
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
    "check-status": Flags.string({
      description:
        "Invocation ID to inspect without creating a new invocation.",
      helpValue: "<invocationId>",
    }),
    "no-wait": Flags.boolean({
      description: "Return immediately after creating the invocation.",
    }),
    params: Flags.string({
      description: "JSON params to pass to the function.",
      helpValue: "<params>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionsInvoke);
    await invokeFunction({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      checkStatus: flags["check-status"],
      functionId: args.functionId,
      noWait: flags["no-wait"] ?? false,
      params: flags.params,
    });
  }
}
