import { Args, Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { reduceLogs } from "../../../lib/cloud/reduce-logs.js";
import { BrowseCommand } from "../../../base.js";

export default class SessionsLogs extends BrowseCommand {
  static override description = "Get Browserbase session logs.";
  static override examples = [
    "browse cloud sessions logs <session-id>",
    "browse cloud sessions logs <session-id> --only-errors",
    "browse cloud sessions logs <session-id> --only-errors --failed-requests",
  ];

  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
  };

  static override flags = {
    ...apiCommonFlags,
    "only-errors": Flags.boolean({
      description:
        "Return only the high-signal error records (console errors/exceptions, HTTP 4xx/5xx, network failures) instead of the full CDP firehose.",
      default: false,
    }),
    "failed-requests": Flags.boolean({
      description:
        "With --only-errors, narrow to failed / error-status network requests only.",
      default: false,
      dependsOn: ["only-errors"],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsLogs);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const raw = await client.sessions.logs.list(args.id);
      if (flags["only-errors"]) {
        const arr = Array.isArray(raw)
          ? raw
          : ((raw as { data?: unknown[] })?.data ?? []);
        outputJson(
          reduceLogs(arr as never[], {
            failedRequests: flags["failed-requests"],
          }),
        );
      } else {
        outputJson(raw);
      }
    });
  }
}
