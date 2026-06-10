import { Args } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  resolveUploadableFile,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ExtensionsUpload extends BrowseCommand {
  static override description = "Upload a Chrome extension ZIP file.";
  static override examples = ["browse cloud extensions upload ./extension.zip"];

  static override args = {
    file: Args.string({
      required: true,
      description: "Path to extension ZIP file.",
    }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExtensionsUpload);
    await withBrowserbaseApi("extensions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(
        await client.extensions.create({
          file: await resolveUploadableFile(args.file, "extension"),
        }),
      );
    });
  }
}
