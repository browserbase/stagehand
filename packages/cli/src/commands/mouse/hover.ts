import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  parseNumber,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class MouseHover extends BrowseCommand {
  static override description =
    "Move the mouse to raw viewport coordinates in the active page.";

  static override examples = [
    "browse mouse hover 240 320",
    "browse mouse hover 240 320 --session research",
  ];

  static override args = {
    x: Args.string({ description: "Viewport x coordinate.", required: true }),
    y: Args.string({ description: "Viewport y coordinate.", required: true }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MouseHover);
    await runDriverCommandFromFlags(
      "mouse.hover",
      {
        x: parseNumber(args.x, "x"),
        y: parseNumber(args.y, "y"),
      },
      flags,
    );
  }
}
