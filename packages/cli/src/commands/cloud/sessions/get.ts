import { Args, Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  requestBrowserbaseJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";
import { fail } from "../../../lib/errors.js";

export default class SessionsGet extends BrowseCommand {
  static override description = "Get a Browserbase session by ID.";
  static override examples = [
    "browse cloud sessions get <session-id>",
    "browse cloud sessions get <session-id> --include-labels",
  ];

  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
  };

  static override flags = {
    ...apiCommonFlags,
    "include-labels": Flags.boolean({
      description: "Include assigned labels. Fails if label reads are unavailable.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsGet);
    await withBrowserbaseApi("sessions", async () => {
      const options = toApiOptions(flags);
      if (flags["include-labels"]) {
        const session = await requestBrowserbaseJson<Record<string, unknown>>(
          options,
          `/v1/sessions/${encodeURIComponent(args.id)}?includeLabels=true`,
        );
        if (!Array.isArray(session.labels)) {
          fail("Session labels are unavailable for this project or API endpoint.", 1, {
            resultCode: "session_labels_unavailable",
            httpStatus: 200,
            requestHadHttpResponse: true,
          });
        }
        outputJson(session);
        return;
      }
      const client = createBrowserbaseClient(options);
      outputJson(await client.sessions.retrieve(args.id));
    });
  }
}
