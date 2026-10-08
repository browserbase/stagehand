import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Upload extends BrowseCommand {
  static override description =
    "Upload one or more files into a file input by snapshot ref, XPath, or selector.";

  static override examples = [
    "browse upload @0-4 ./resume.pdf",
    "browse upload 'input[type=file]' ./one.png --file ./two.png",
    "browse upload @0-4 ./resume.pdf --session research",
  ];

  static override args = {
    selector: Args.string({
      description: "Snapshot ref such as @0-4, XPath, or selector.",
      required: true,
    }),
    file: Args.string({
      description: "File path to upload.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    file: Flags.string({
      description: "Additional file path. Repeat for multiple files.",
      helpValue: "<path>",
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Upload);
    await runDriverCommandFromFlags(
      "upload",
      { files: [args.file, ...(flags.file ?? [])], selector: args.selector },
      flags,
    );
  }
}
