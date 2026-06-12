import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
    "browse screenshot",
    "browse screenshot --path page.png",
    "browse screenshot --full-page",
    "browse screenshot --type jpeg --quality 80",
    "browse screenshot --clip 0,0,800,600 --path clipped.png",
    "browse screenshot --base64",
  ];

  static override flags = {
    ...driverCommandFlags,
    animations: Flags.string({
      description: "Whether CSS animations run during capture.",
      options: ["allow", "disabled"],
    }),
    base64: Flags.boolean({
      description:
        "Print base64 to stdout instead of writing a file (legacy default).",
      exclusive: ["path"],
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
        "Write the screenshot to this file. Defaults to screenshot-<timestamp>.<type> in the current directory.",
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
    const path =
      flags.path ??
      (flags.base64 ? undefined : defaultScreenshotPath(flags.type));
    await runDriverCommandFromFlags(
      "screenshot",
      {
        animations: flags.animations,
        caret: flags.caret,
        clip: parseClip(flags.clip),
        fullPage: flags["full-page"],
        path,
        quality: flags.quality,
        type: flags.type,
      },
      flags,
    );
  }
}

function defaultScreenshotPath(type: string | undefined): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const extension = type === "jpeg" ? "jpeg" : "png";
  let candidate = resolve(`screenshot-${stamp}.${extension}`);
  for (let counter = 2; existsSync(candidate); counter += 1) {
    candidate = resolve(`screenshot-${stamp}-${counter}.${extension}`);
  }
  return candidate;
}
