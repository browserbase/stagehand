import { projectIdArg } from "../../../lib/cloud/args.js";
import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class ProjectsGet extends BrowseCommand {
  static override description = "Get a project by ID.";
  static override examples = ["browse cloud projects get <project-id>"];

  static override args = {
    id: projectIdArg,
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ProjectsGet);
    await withBrowserbaseApi("projects", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.projects.retrieve(args.id));
    });
  }
}
