import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../../../base.js";
import { outputJson, requestBrowserbaseJson } from "../../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../../lib/cloud/flags.js";
import { labelFlagOptions, normalizeSessionLabels } from "../../../../lib/session-labels.js";

export default class SessionLabelsSet extends BrowseCommand {
  static override description =
    "Replace all labels on a session. Creates missing label names. Use labels clear to remove all labels.";
  static override examples = [
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
    outputJson(
      await requestBrowserbaseJson(
        toApiOptions(flags),
        `/v1/sessions/${encodeURIComponent(args.id)}/labels`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ labels }),
        },
      ),
    );
  }
}
