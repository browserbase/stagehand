import { Args } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  driverCommandFlags,
  parseNumber,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class MouseScroll extends BrowseCommand {
  static override description =
    "Scroll from raw viewport coordinates in the active page.";

  static override examples = [
    "browse mouse scroll 400 500 0 600",
    "browse mouse scroll 400 500 0 -600",
  ];

  static override args = {
    x: Args.string({ description: "Viewport x coordinate.", required: true }),
    y: Args.string({ description: "Viewport y coordinate.", required: true }),
    deltaX: Args.string({
      description: "Horizontal scroll delta.",
      required: true,
    }),
    deltaY: Args.string({
      description: "Vertical scroll delta.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MouseScroll);
    await runDriverCommandFromFlags(
      "mouse.scroll",
      {
        deltaX: parseNumber(args.deltaX, "deltaX"),
        deltaY: parseNumber(args.deltaY, "deltaY"),
        x: parseNumber(args.x, "x"),
        y: parseNumber(args.y, "y"),
      },
      flags,
    );
  }
}
