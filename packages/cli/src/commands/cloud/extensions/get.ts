import { extensionIdArg } from "../../../lib/cloud/args.js";
import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ExtensionsGet extends BrowseCommand {
  static override description = "Get a Chrome extension by ID.";
  static override examples = ["browse cloud extensions get <extension-id>"];

  static override args = {
    id: extensionIdArg,
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExtensionsGet);
    await withBrowserbaseApi("extensions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.extensions.retrieve(args.id));
    });
  }
}
