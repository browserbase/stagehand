import { Args, Flags } from "@oclif/core";
import { toFile } from "@browserbasehq/sdk";
import { getExtensionArchive } from "@browserbasehq/stagehand";

import {
  createBrowserbaseClient,
  outputJson,
  resolveUploadableFile,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";
import { fail } from "../../../lib/errors.js";

export default class ExtensionsUpload extends BrowseCommand {
  static override description =
    "Upload a Chrome extension ZIP file or the bundled Stagehand extension.";
  static override examples = [
    "browse cloud extensions upload ./extension.zip",
    "browse cloud extensions upload --stagehand",
  ];

  static override args = {
    file: Args.string({
      required: false,
      description: "Path to extension ZIP file.",
    }),
  };

  static override flags = {
    ...apiCommonFlags,
    stagehand: Flags.boolean({
      description: "Upload the Stagehand extension bundled with the SDK.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ExtensionsUpload);

    if (flags.stagehand && args.file) {
      fail("Cannot specify both --stagehand and a file path.");
    }
    if (!flags.stagehand && !args.file) {
      fail(
        "Provide a file path or use --stagehand to upload the Stagehand extension.",
      );
    }

    await withBrowserbaseApi("extensions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));

      let file;
      if (flags.stagehand) {
        const archive = await getExtensionArchive();
        file = await toFile(archive, "stagehand-extension.zip", {
          type: "application/zip",
        });
      } else {
        file = await resolveUploadableFile(args.file!, "extension");
      }

      outputJson(await client.extensions.create({ file }));
    });
  }
}
