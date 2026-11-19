import { Args, Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  resolveBody,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { fail } from "../../../lib/errors.js";
import { BrowseCommand } from "../../../base.js";

export default class SessionsUpdate extends BrowseCommand {
  static override description =
    "Request release of a Browserbase session. To change labels, use sessions labels set or clear.";
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
      description: "Optional JSON request body. Merged with --status when provided.",
      helpValue: "<body>",
    }),
    stdin: Flags.boolean({
      description: "Read JSON request body from stdin.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsUpdate);
    await withBrowserbaseApi("sessions", async () => {
      const requestBody = await resolveBody({ body: flags.body, stdin: flags.stdin });
      if (Object.hasOwn(requestBody, "label") || Object.hasOwn(requestBody, "labels")) {
        fail(
          "Session updates release the browser and cannot change labels. Use 'browse cloud sessions labels set <session-id> --label <name>' or 'browse cloud sessions labels clear <session-id>'.",
        );
      }
      const client = createBrowserbaseClient(toApiOptions(flags));
      const body = {
        ...requestBody,
        status: (flags.status ?? "REQUEST_RELEASE") as "REQUEST_RELEASE",
      };
      outputJson(await client.sessions.update(args.id, body));
    });
  }
}
