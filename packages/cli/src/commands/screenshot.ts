import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
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
        "Write the screenshot to this file. Defaults to screenshot-<timestamp>.png (or .jpeg with --type jpeg) in the current directory.",
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
    const defaultPath = getDefaultPathFromFlags(flags);
    try {
      await runDriverCommandFromFlags(
        "screenshot",
        {
          animations: flags.animations,
          caret: flags.caret,
          clip: parseClip(flags.clip),
          fullPage: flags["full-page"],
          path: flags.path ?? defaultPath,
          quality: flags.quality,
          type: flags.type,
        },
        flags,
      );
    } catch (error) {
      if (defaultPath) removeIfEmpty(defaultPath);
      throw error;
    }
  }
}

// Generous upper bound on filename-collision retries; far beyond any real
// same-second burst, it just guarantees the loop below always terminates.
const MAX_RESERVE_ATTEMPTS = 1000;

/**
 * Resolves the file the screenshot should be written to, or undefined when the
 * driver should return base64 (explicit --path is handled separately; --base64
 * opts out of a file entirely).
 */
export function getDefaultPathFromFlags(flags: {
  path?: string;
  base64?: boolean;
  type?: string;
}): string | undefined {
  if (flags.path || flags.base64) return undefined;
  return reserveDefaultScreenshotPath(flags.type);
}

/**
 * Picks the next free screenshot-<timestamp>[-<counter>].<type> name in the
 * current directory and reserves it. "Reserve" = create the file with an
 * exclusive open (`wx` → O_CREAT|O_EXCL), which atomically fails with EEXIST if
 * the name already exists, so two concurrent runs can never claim the same
 * file. On EEXIST we advance the counter and try the next name.
 */
export function reserveDefaultScreenshotPath(type: string | undefined): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const extension = type === "jpeg" ? "jpeg" : "png";
  for (let counter = 1; counter <= MAX_RESERVE_ATTEMPTS; counter += 1) {
    const suffix = counter === 1 ? "" : `-${counter}`;
    const candidate = resolve(`screenshot-${stamp}${suffix}.${extension}`);
    try {
      // Exclusive create reserves the name; close immediately since the driver
      // (re)writes the file. The empty placeholder is cleaned up on failure.
      closeSync(openSync(candidate, "wx"));
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(
    `Could not reserve a screenshot filename after ${MAX_RESERVE_ATTEMPTS} attempts; pass --path to choose one.`,
  );
}

// Removes the reserved placeholder when the screenshot failed before the driver
// wrote to it. `path` is always a file we created via openSync above, so the
// isFile guard is just defensive against an unexpected directory/symlink.
export function removeIfEmpty(path: string): void {
  try {
    const stats = statSync(path);
    if (stats.isFile() && stats.size === 0) unlinkSync(path);
  } catch {
    // Best effort: leave the placeholder behind rather than mask the error.
  }
}
