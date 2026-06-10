import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  parseClip,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Screenshot extends BrowseCommand {
  static override description =
    "Capture a screenshot of the active browser page.";

  static override examples = [
    "browse screenshot --path page.png",
    "browse screenshot --full-page --path page.png",
    "browse screenshot --type jpeg --quality 80",
    "browse screenshot --clip 0,0,800,600 --path clipped.png",
  ];

  static override flags = {
    ...driverCommandFlags,
    animations: Flags.string({
      description: "Whether CSS animations run during capture.",
      options: ["allow", "disabled"],
    }),
    caret: Flags.string({
      description: "Whether text caret is hidden during capture.",
      options: ["hide", "initial"],
    }),
    clip: Flags.string({
      description: "Clip rectangle as x,y,width,height.",
      helpValue: "<x,y,width,height>",
    }),
    "full-page": Flags.boolean({
      description: "Capture the full scrollable page.",
    }),
    path: Flags.string({
      char: "p",
      description:
        "Write the screenshot to a file. Without this flag, base64 is printed.",
      helpValue: "<path>",
    }),
    quality: Flags.integer({
      description: "JPEG quality from 0 to 100.",
      helpValue: "<quality>",
    }),
    type: Flags.string({
      description: "Screenshot image type.",
      options: ["png", "jpeg"],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Screenshot);
    await runDriverCommandFromFlags(
      "screenshot",
      {
        animations: flags.animations,
        caret: flags.caret,
        clip: parseClip(flags.clip),
        fullPage: flags["full-page"],
        path: flags.path,
        quality: flags.quality,
        type: flags.type,
      },
      flags,
    );
  }
}
