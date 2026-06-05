import { Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  resolveBody,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsCreate extends BrowseCommand {
  static override description = "Create a Browserbase context.";
  static override examples = [
    "browse cloud contexts create",
    `browse cloud contexts create --body '{"region":"us-west-2"}'`,
    `echo '{"region":"us-west-2"}' | browse cloud contexts create --stdin`,
  ];

  static override flags = {
    ...apiCommonFlags,
    body: Flags.string({
      description: "Optional JSON request body.",
      helpValue: "<body>",
    }),
    stdin: Flags.boolean({
      description: "Read JSON request body from stdin.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ContextsCreate);
    await withBrowserbaseApi("contexts", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const body = await resolveBody({ body: flags.body, stdin: flags.stdin });
      outputJson(await client.contexts.create(body));
    });
  }
}
