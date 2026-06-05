import { Args } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsGet extends BrowseCommand {
  static override description = "Get a Browserbase context by ID.";
  static override examples = ["browse cloud contexts get <context-id>"];

  static override args = {
    id: Args.string({ required: true, description: "Context ID." }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextsGet);
    await withBrowserbaseApi("contexts", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.contexts.retrieve(args.id));
    });
  }
}
