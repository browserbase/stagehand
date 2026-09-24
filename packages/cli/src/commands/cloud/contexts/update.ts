import { Args } from "@oclif/core";

import { apiCommonFlags } from "../../../lib/cloud/flags.js";
import { fail } from "../../../lib/errors.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsUpdate extends BrowseCommand {
  static override state = "deprecated";
  static override description =
    "Deprecated: Browserbase no longer supports context uploads. To save browser state, use sessions create with --context-id and --persist, then close the session.";

  static override args = {
    id: Args.string({
      required: true,
      description: "Context ID or saved name.",
    }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    await this.parse(ContextsUpdate);
    fail(
      'Browserbase no longer supports context uploads. To save browser state, use "browse cloud sessions create --context-id <context-id|name> --persist", then close the session.',
    );
  }
}
