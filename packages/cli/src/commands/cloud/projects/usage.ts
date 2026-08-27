import { Args } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ProjectsUsage extends BrowseCommand {
  static override description = "Get project usage.";
  static override examples = ["browse cloud projects usage <project-id>"];

  static override args = {
    id: Args.string({ required: true, description: "Project ID." }),
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProjectsUsage);
    await withBrowserbaseApi("projects", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.projects.usage(args.id));
    });
  }
}
