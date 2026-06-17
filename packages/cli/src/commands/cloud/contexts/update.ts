import { Args } from "@oclif/core";

import { outputJson, requestBrowserbaseJson } from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsUpdate extends BrowseCommand {
  static override description =
    "Refresh the upload URL for a Browserbase context.";
  static override examples = ["browse cloud contexts update <context-id>"];

  static override args = {
    id: Args.string({ required: true, description: "Context ID." }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextsUpdate);
    outputJson(
      await requestBrowserbaseJson(
        toApiOptions(flags),
        `/v1/contexts/${args.id}`,
        {
          method: "PUT",
        },
      ),
    );
  }
}
