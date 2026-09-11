import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import { initFunctionsProject } from "../../lib/functions/init.js";

const packageManagers = ["npm", "pnpm"] as const;

export default class FunctionsInit extends BrowseCommand {
  static override description =
    "Initialize a new Browserbase Functions project.";

  static override examples = [
    "browse functions init my-function",
    "browse functions init my-function --package-manager npm",
  ];

  static override args = {
    projectName: Args.string({
      description: "Directory name for the new Functions project.",
      required: false,
    }),
  };

  static override flags = {
    "package-manager": Flags.string({
      default: "pnpm",
      description: "Package manager to use.",
      options: [...packageManagers],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionsInit);
    await initFunctionsProject({
      packageManager: flags["package-manager"] as "npm" | "pnpm",
      projectName: args.projectName ?? "my-browserbase-function",
    });
  }
}
