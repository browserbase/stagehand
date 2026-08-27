import { Args, Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  resolveBody,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class SessionsUpdate extends BrowseCommand {
  static override description = "Update a Browserbase session.";
  static override examples = [
    "browse cloud sessions update <session-id> --status REQUEST_RELEASE",
    `browse cloud sessions update <session-id> --body '{"status":"REQUEST_RELEASE"}'`,
  ];

  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
  };

  static override flags = {
    ...apiCommonFlags,
    status: Flags.string({
      description: `Session status update. (choices: "REQUEST_RELEASE")`,
      options: ["REQUEST_RELEASE"],
      default: "REQUEST_RELEASE",
      helpValue: "<status>",
    }),
    body: Flags.string({
      description:
        "Optional JSON request body. Merged with --status when provided.",
      helpValue: "<body>",
    }),
    stdin: Flags.boolean({
      description: "Read JSON request body from stdin.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsUpdate);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const body = {
        ...(await resolveBody({ body: flags.body, stdin: flags.stdin })),
        status: (flags.status ?? "REQUEST_RELEASE") as "REQUEST_RELEASE",
      };
      outputJson(await client.sessions.update(args.id, body));
    });
  }
}
