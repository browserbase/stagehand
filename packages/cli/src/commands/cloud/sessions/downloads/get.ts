import { Args, Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
  writeBinaryOutput,
} from "../../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../../base.js";

export default class SessionsDownloadsGet extends BrowseCommand {
  static override description =
    "Download Browserbase session files as a ZIP archive.";
  static override examples = [
    "browse cloud sessions downloads get <session-id>",
    "browse cloud sessions downloads get <session-id> --output ./downloads.zip",
  ];

  static override args = {
    id: Args.string({ required: true, description: "Session ID." }),
  };

  static override flags = {
    ...apiCommonFlags,
    output: Flags.string({
      description: "Path to write the ZIP file.",
      helpValue: "<output>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsDownloadsGet);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const response = await client.sessions.downloads.list(args.id);
      const outputPath = flags.output ?? `${args.id}-downloads.zip`;
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeBinaryOutput(outputPath, bytes);
      outputJson({ ok: true, outputPath, sizeBytes: bytes.byteLength });
    });
  }
}
