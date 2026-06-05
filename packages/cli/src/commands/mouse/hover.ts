import { Args, Flags } from "@oclif/core";

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
    "browse mouse hover 240 320 --return-xpath",
    "browse mouse hover 240 320 --session research",
  ];

  static override args = {
    x: Args.string({ description: "Viewport x coordinate.", required: true }),
    y: Args.string({ description: "Viewport y coordinate.", required: true }),
  };

  static override flags = {
    ...driverCommandFlags,
    "return-xpath": Flags.boolean({
      description:
        "Include the XPath under the coordinate when the driver can return it.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MouseHover);
    await runDriverCommandFromFlags(
      "mouse.hover",
      {
        returnXPath: flags["return-xpath"],
        x: parseNumber(args.x, "x"),
        y: parseNumber(args.y, "y"),
      },
      flags,
    );
  }
}
