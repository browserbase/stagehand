import { Args } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  resolveUploadableFile,
  withBrowserbaseApi,
} from "../../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../../base.js";

export default class SessionsUploadsCreate extends BrowseCommand {
  static override description = "Upload a file to a Browserbase session.";
  static override examples = [
    "browse cloud sessions uploads create <session-id> ./file.pdf",
  ];

  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
    file: Args.string({
      required: true,
      description: "Path to file to upload.",
    }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsUploadsCreate);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(
        await client.sessions.uploads.create(args.id, {
          file: await resolveUploadableFile(args.file, "session upload"),
        }),
      );
    });
  }
}
