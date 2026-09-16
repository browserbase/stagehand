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
    "Create a Browserbase context. Pass --name to store a project-scoped name in Browserbase and cache its ID locally.";
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
        "Set the Context name in Browserbase and cache its ID for local name lookup.",
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
      const existingAlias = await getContextAlias(name);
      if (existingAlias) {
        fail(
          `A context named "${name}" already exists locally and maps to ${existingAlias.id}. ` +
            "Existing local aliases are preserved because they may predate Browserbase-managed Context names. " +
            "Choose another name, or reconcile the alias explicitly with " +
            "`browse cloud contexts add <name> <context-id> --force`.",
        );
      }
    }

    await withBrowserbaseApi("contexts", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const body = await resolveBody({ body: flags.body, stdin: flags.stdin });
      // Browserbase owns name uniqueness and canonical storage. The explicit
      // flag takes precedence over a name supplied through --body/--stdin,
      // matching the merge behavior of other cloud command flags.
      const context = await client.contexts.create(
        name === undefined ? body : { ...body, name },
      );

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
