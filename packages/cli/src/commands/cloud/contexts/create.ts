import { Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  resolveBody,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import {
  contextNameRequirement,
  getContextAlias,
  isValidContextName,
  saveContextAlias,
} from "../../../lib/cloud/contexts-store.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { fail } from "../../../lib/errors.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsCreate extends BrowseCommand {
  static override description =
    "Create a Browserbase context. Pass --name to save a local alias you can reuse instead of the context ID.";
  static override examples = [
    "browse cloud contexts create",
    "browse cloud contexts create --name github",
    `browse cloud contexts create --body '{"region":"us-west-2"}'`,
    `echo '{"region":"us-west-2"}' | browse cloud contexts create --stdin`,
  ];

  static override flags = {
    ...apiCommonFlags,
    name: Flags.string({
      description:
        "Save a local alias for the new context so you can reuse it by name.",
      helpValue: "<name>",
    }),
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

    const name = flags.name;
    if (name !== undefined) {
      if (!isValidContextName(name)) {
        fail(`Invalid context name "${name}". ${contextNameRequirement()}`);
      }
      if (await getContextAlias(name)) {
        fail(
          `A context named "${name}" already exists locally. Choose another name or remove it with "browse cloud contexts delete ${name}".`,
        );
      }
    }

    await withBrowserbaseApi("contexts", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const body = await resolveBody({ body: flags.body, stdin: flags.stdin });
      const context = await client.contexts.create(body);

      if (name !== undefined && context.id) {
        await saveContextAlias(name, {
          id: context.id,
          createdAt: new Date().toISOString(),
        });
        outputJson({ ...context, name });
        return;
      }

      outputJson(context);
    });
  }
}
