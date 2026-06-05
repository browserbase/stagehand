import { Args } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
  timeoutMsFlag,
  waitUntilFlag,
} from "../lib/driver/command-cli.js";

export default class Open extends BrowseCommand {
  static override description = "Open a URL in a browse driver session.";

  static override examples = [
    "browse open https://example.com",
    "browse open https://example.com --local --headed",
    "browse open https://example.com --remote",
    "browse open https://example.com --auto-connect",
    "browse open https://example.com --cdp 9222",
    "browse open https://example.com --cdp ws://127.0.0.1:9222/devtools/browser/<id> --target-id <target-id>",
    "browse open https://example.com --session research",
    "browse open https://example.com --wait networkidle --timeout 45000",
  ];

  static override args = {
    url: Args.string({
      required: true,
      description: "URL to open.",
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    timeout: timeoutMsFlag,
    wait: waitUntilFlag,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Open);
    await runDriverCommandFromFlags(
      "open",
      { timeoutMs: flags.timeout, url: args.url, waitUntil: flags.wait },
      flags,
    );
  }
}
