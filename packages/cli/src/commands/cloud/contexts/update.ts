import { Args } from "@oclif/core";

import { apiCommonFlags } from "../../../lib/cloud/flags.js";
import { fail } from "../../../lib/errors.js";
import { BrowseCommand } from "../../../base.js";

const migrationGuidance =
  "Browserbase no longer supports context uploads. To save browser state, use " +
  '"browse cloud sessions create --context-id <context-id|name> --persist". ' +
  'When finished, close the session with "browse cloud sessions update <session-id> --status REQUEST_RELEASE".';

export default class ContextsUpdate extends BrowseCommand {
  static override state = "deprecated";
  static override description = `Deprecated: ${migrationGuidance}`;

  static override args = {
    id: Args.string({
      required: true,
      description: "Context ID or saved name.",
    }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    await this.parse(ContextsUpdate);
    fail(migrationGuidance);
  }
}
