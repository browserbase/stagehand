import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  runDriverCommandFromFlags,
} from "../lib/driver/command-cli.js";

export default class Select extends BrowseCommand {
  static override description =
    "Select an option on a select-like element by snapshot ref, XPath, or selector.";

  static override examples = [
    "browse select @0-9 'CA'",
    "browse select 'select[name=state]' 'CA'",
    "browse select @0-9 'CA' --value 'NV'",
  ];

  static override args = {
    selector: Args.string({
      description: "Snapshot ref such as @0-9, XPath, or selector.",
      required: true,
    }),
    value: Args.string({
      description: "Option value or label to select.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    value: Flags.string({
      description:
        "Additional option value for multi-select controls. Repeat for multiple values.",
      helpValue: "<value>",
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Select);
    await runDriverCommandFromFlags(
      "select",
      { selector: args.selector, values: [args.value, ...(flags.value ?? [])] },
      flags,
    );
  }
}
