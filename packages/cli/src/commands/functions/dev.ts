import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { startFunctionsDevServer } from "../../lib/functions/dev.js";

export default class FunctionsDev extends BrowseCommand {
  static override description =
    "Run the local Browserbase Functions development server.";

  static override examples = [
    "browse functions dev index.ts",
    "browse functions dev index.ts --port 3000 --verbose",
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
    host: Flags.string({
      default: "127.0.0.1",
      description: "Host to bind to.",
      helpValue: "<host>",
    }),
    port: Flags.integer({
      default: 14113,
      description: "Port to listen on.",
      helpValue: "<port>",
    }),
    verbose: Flags.boolean({
      description: "Print verbose runtime logs.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionsDev);
    await startFunctionsDevServer({
      apiKey: flags["api-key"],
      baseUrl: flags["base-url"],
      entrypoint: args.entrypoint,
      host: flags.host,
      port: flags.port,
      verbose: flags.verbose ?? false,
    });
  }
}
