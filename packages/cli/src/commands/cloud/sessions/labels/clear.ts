import { Args } from "@oclif/core";

import { BrowseCommand } from "../../../../base.js";
import { outputJson, requestBrowserbaseJson } from "../../../../lib/cloud/api.js";
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
    outputJson(
      await requestBrowserbaseJson(
        toApiOptions(flags),
        `/v1/sessions/${encodeURIComponent(args.id)}/labels`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ labels: [] }),
        },
      ),
    );
  }
}
