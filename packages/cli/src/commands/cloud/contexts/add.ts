import { Args, Flags } from "@oclif/core";

import {
  contextNameRequirement,
  getContextAlias,
  isValidContextName,
  saveContextAlias,
} from "../../../lib/cloud/contexts-store.js";
import { fail } from "../../../lib/errors.js";
import { outputJson } from "../../../lib/output.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsAdd extends BrowseCommand {
  static override description =
    "Save a local name for an existing Browserbase context ID so you can reuse it by name (e.g. an ID a teammate shared or one created on another device).";
  static override examples = [
    "browse cloud contexts add github 45ed525f-63a5-490d-b4c4-853f50643b90",
    "browse cloud contexts add github <new-id> --force",
  ];

  static override args = {
    name: Args.string({ required: true, description: "Local name to save." }),
    id: Args.string({
      required: true,
      description: "Existing Browserbase context ID.",
    }),
  };

  static override flags = {
    force: Flags.boolean({
      description: "Overwrite the name if it is already saved locally.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextsAdd);

    if (!isValidContextName(args.name)) {
      fail(`Invalid context name "${args.name}". ${contextNameRequirement()}`);
    }
    if (args.id.trim().length === 0) {
      fail("Context ID cannot be empty.");
    }
    if (!flags.force && (await getContextAlias(args.name))) {
      fail(
        `A context named "${args.name}" already exists locally. Pass --force to overwrite, ` +
          `or remove it with "browse cloud contexts delete ${args.name}".`,
      );
    }

    await saveContextAlias(args.name, {
      id: args.id,
      createdAt: new Date().toISOString(),
    });
    outputJson({ name: args.name, id: args.id });
  }
}
