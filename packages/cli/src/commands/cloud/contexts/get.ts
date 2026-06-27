import { Args } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { resolveContextRef } from "../../../lib/cloud/contexts-store.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsGet extends BrowseCommand {
  static override description =
    "Get a Browserbase context by ID or saved name.";
  static override examples = [
    "browse cloud contexts get <context-id>",
    "browse cloud contexts get github",
  ];

  static override args = {
    id: Args.string({
      required: true,
      description: "Context ID or saved name.",
    }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextsGet);
    const id = await resolveContextRef(args.id);
    await withBrowserbaseApi("contexts", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.contexts.retrieve(id));
    });
  }
}
