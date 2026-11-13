import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../../../base.js";
import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../../lib/cloud/flags.js";
import { labelFlagOptions, normalizeSessionLabels } from "../../../../lib/session-labels.js";

export default class SessionLabelsSet extends BrowseCommand {
  static override description =
    "Replace all labels on a session. Creates missing label names. Use labels clear to remove all labels.";
  static override examples = [
    'browse cloud sessions labels set <session-id> --label "Store A"',
    'browse cloud sessions labels set <session-id> --label "Store A" --label Checkout',
  ];
  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
  };
  static override flags = {
    ...apiCommonFlags,
    label: Flags.string({ ...labelFlagOptions, required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionLabelsSet);
    const labels = normalizeSessionLabels(flags.label);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.sessions.setLabels(encodeURIComponent(args.id), { labels }));
    });
  }
}
