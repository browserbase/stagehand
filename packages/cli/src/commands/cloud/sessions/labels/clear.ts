import { Args } from "@oclif/core";

import { BrowseCommand } from "../../../../base.js";
import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../../lib/cloud/flags.js";

export default class SessionLabelsClear extends BrowseCommand {
  static override description = "Remove all label assignments from a session.";
  static override examples = ["browse cloud sessions labels clear <session-id>"];
  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
  };
  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionLabelsClear);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.sessions.setLabels(encodeURIComponent(args.id), { labels: [] }));
    });
  }
}
