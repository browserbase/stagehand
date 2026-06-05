import { Args } from "@oclif/core";

import { outputJson, requestBrowserbase } from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsDelete extends BrowseCommand {
  static override description = "Delete a Browserbase context.";
  static override examples = ["browse cloud contexts delete <context-id>"];

  static override args = {
    id: Args.string({ required: true, description: "Context ID." }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextsDelete);
    await requestBrowserbase(toApiOptions(flags), `/v1/contexts/${args.id}`, {
      method: "DELETE",
      headers: {
        Accept: "*/*",
      },
    });
    outputJson({ ok: true, id: args.id });
  }
}
