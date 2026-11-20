import { Args } from "@oclif/core";

import { createBrowserbaseClient, outputJson, withBrowserbaseApi } from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ExtensionsDelete extends BrowseCommand {
  static override description = "Delete a Chrome extension.";
  static override examples = ["browse cloud extensions delete <extension-id>"];

  static override args = {
    id: Args.string({ required: true, description: "Extension ID." }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExtensionsDelete);
    const client = createBrowserbaseClient(toApiOptions(flags));
    await withBrowserbaseApi("extensions", () => client.extensions.delete(args.id));
    outputJson({ ok: true, id: args.id });
  }
}
