import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  buttonFlag,
  driverCommandFlags,
  parseNumber,
  runDriverCommandFromFlags,
} from "../../lib/driver/command-cli.js";

export default class MouseDrag extends BrowseCommand {
  static override description =
    "Drag from one raw viewport coordinate to another.";

  static override examples = [
    "browse mouse drag 100 100 400 400",
    "browse mouse drag 100 100 400 400 --steps 20 --delay 10",
    "browse mouse drag 100 100 400 400 --return-xpath",
  ];

  static override args = {
    fromX: Args.string({
      description: "Starting viewport x coordinate.",
      required: true,
    }),
    fromY: Args.string({
      description: "Starting viewport y coordinate.",
      required: true,
    }),
    toX: Args.string({
      description: "Ending viewport x coordinate.",
      required: true,
    }),
    toY: Args.string({
      description: "Ending viewport y coordinate.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    button: buttonFlag,
    delay: Flags.integer({
      default: 0,
      description: "Delay between drag steps in milliseconds.",
      helpValue: "<ms>",
    }),
    "return-xpath": Flags.boolean({
      description:
        "Include the XPath under the start/end coordinates when the driver can return it.",
    }),
    steps: Flags.integer({
      default: 10,
      description: "Number of intermediate drag steps.",
      helpValue: "<steps>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MouseDrag);
    await runDriverCommandFromFlags(
      "mouse.drag",
      {
        button: flags.button,
        delay: flags.delay,
        fromX: parseNumber(args.fromX, "fromX"),
        fromY: parseNumber(args.fromY, "fromY"),
        returnXPath: flags["return-xpath"],
        steps: flags.steps,
        toX: parseNumber(args.toX, "toX"),
        toY: parseNumber(args.toY, "toY"),
      },
      flags,
    );
  }
}
