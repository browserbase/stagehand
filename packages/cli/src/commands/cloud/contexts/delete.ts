import { Args } from "@oclif/core";

import { outputJson, requestBrowserbase } from "../../../lib/cloud/api.js";
import {
  removeContextAliasesById,
  resolveContextRef,
} from "../../../lib/cloud/contexts-store.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ContextsDelete extends BrowseCommand {
  static override description =
    "Delete a Browserbase context by ID or saved name.";
  static override examples = [
    "browse cloud contexts delete <context-id>",
    "browse cloud contexts delete github",
  ];

  static override args = {
    id: Args.string({
      required: true,
      description: "Context ID or saved name.",
    }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ContextsDelete);
    const id = await resolveContextRef(args.id);
    await requestBrowserbase(toApiOptions(flags), `/v1/contexts/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "*/*",
      },
    });
    // Keep the local name map consistent: drop any aliases pointing at the
    // now-deleted context (whether the user passed a name or a raw id). The
    // remote delete already succeeded, so a local cleanup failure must not turn
    // the command into a false negative — best-effort, never throws.
    let removed: string[];
    try {
      removed = await removeContextAliasesById(id);
    } catch {
      removed = [];
    }
    outputJson({
      ok: true,
      id,
      ...(removed.length ? { removedAliases: removed } : {}),
    });
  }
}
