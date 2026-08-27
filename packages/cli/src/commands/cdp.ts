import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { DEFAULT_CDP_DOMAINS, tailCdp } from "../lib/driver/cdp-tail.js";

export default class Cdp extends BrowseCommand {
  static override description =
    "Attach to a CDP endpoint and stream DevTools protocol events.";

  static override examples = [
    "browse cdp 9222",
    "browse cdp http://127.0.0.1:9222",
    "browse cdp ws://127.0.0.1:9222/devtools/browser/<id> --domain Network --domain Page",
    "browse cdp 9222 --pretty",
  ];

  static override args = {
    target: Args.string({
      description: "CDP WebSocket URL, http(s) DevTools URL, or local port.",
      required: true,
    }),
  };

  static override flags = {
    domain: Flags.string({
      description: `CDP domain to enable. Repeat for multiple domains. Defaults to ${DEFAULT_CDP_DOMAINS.join(", ")}.`,
      helpValue: "<domain>",
      multiple: true,
    }),
    pretty: Flags.boolean({
      description:
        "Print compact human-readable event lines instead of NDJSON.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Cdp);
    await tailCdp(args.target, { domains: flags.domain, pretty: flags.pretty });
  }
}
