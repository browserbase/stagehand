import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";
import {
  formatId,
  formatUtcDateTime,
  outputFormatFlags,
  outputTable,
  resolveOutputFormat,
} from "../../../lib/output.js";

interface BrowserbaseProject {
  concurrency?: number;
  createdAt?: string;
  defaultTimeout?: number;
  id: string;
  name?: string;
}

export default class ProjectsList extends BrowseCommand {
  static override description = "List projects visible to the current API key.";
  static override examples = [
    "browse cloud projects list",
    "browse cloud projects list --json",
  ];
  static override flags = { ...apiCommonFlags, ...outputFormatFlags };

  async run(): Promise<void> {
    const { flags } = await this.parse(ProjectsList);
    await withBrowserbaseApi("projects", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const projects = (await client.projects.list()) as BrowserbaseProject[];
      if (resolveOutputFormat(flags) === "json") {
        outputJson(projects);
        return;
      }

      outputProjectsTable(projects, { wide: flags.wide });
    });
  }
}

function outputProjectsTable(
  projects: BrowserbaseProject[],
  options: { wide?: boolean },
): void {
  if (projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  outputTable(
    projects,
    [
      {
        header: "ID",
        maxWidth: 12,
        value: (project) => formatId(project.id, options.wide),
      },
      {
        header: "Name",
        maxWidth: 32,
        value: (project) => project.name,
      },
      {
        align: "right",
        header: "Concurrency",
        maxWidth: 11,
        value: (project) => project.concurrency,
      },
      {
        align: "right",
        header: "Timeout",
        maxWidth: 7,
        value: (project) => project.defaultTimeout,
      },
      {
        header: "Created",
        maxWidth: 17,
        value: (project) => formatUtcDateTime(project.createdAt),
      },
    ],
    { wide: options.wide },
  );
}
