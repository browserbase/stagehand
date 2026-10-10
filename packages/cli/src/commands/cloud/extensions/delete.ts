import { extensionIdArg } from "../../../lib/cloud/args.js";
import { outputJson, requestBrowserbase } from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ExtensionsDelete extends BrowseCommand {
  static override description = "Delete a Chrome extension.";
  static override examples = ["browse cloud extensions delete <extension-id>"];

  static override args = {
    id: extensionIdArg,
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExtensionsDelete);
    await requestBrowserbase(
      toApiOptions(flags),
      `/v1/extensions/${encodeURIComponent(args.id)}`,
      {
        method: "DELETE",
        headers: {
          Accept: "*/*",
        },
      },
    );
    outputJson({ ok: true, id: args.id });
  }
}
