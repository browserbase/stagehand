import { outputJson } from "../../../lib/cloud/api.js";
import {
  type ContextAliasEntry,
  listContextAliases,
} from "../../../lib/cloud/contexts-store.js";
import { BrowseCommand } from "../../../base.js";
import {
  formatId,
  formatUtcDateTime,
  outputFormatFlags,
  outputTable,
  resolveOutputFormat,
} from "../../../lib/output.js";

export default class ContextsList extends BrowseCommand {
  static override description =
    "List Browserbase contexts you have saved locally with a name.";
  static override examples = [
    "browse cloud contexts list",
    "browse cloud contexts list --json",
  ];

  static override flags = {
    ...outputFormatFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ContextsList);
    const contexts = await listContextAliases();

    if (resolveOutputFormat(flags) === "json") {
      // Wrap in a named key to match `templates list` / `skills list` so the
      // JSON shape is consistent and machine-readable across list commands.
      outputJson({ contexts });
      return;
    }

    if (contexts.length === 0) {
      console.log(
        "No saved contexts. Create one with: browse cloud contexts create --name <name>",
      );
      return;
    }

    outputContextsTable(contexts, { wide: flags.wide });
  }
}

function outputContextsTable(
  contexts: ContextAliasEntry[],
  options: { wide?: boolean },
): void {
  outputTable(
    contexts,
    [
      {
        header: "Name",
        maxWidth: 24,
        value: (context) => context.name,
      },
      {
        header: "ID",
        maxWidth: 12,
        value: (context) => formatId(context.id, options.wide),
      },
      {
        header: "Created",
        maxWidth: 17,
        value: (context) => formatUtcDateTime(context.createdAt),
      },
    ],
    { wide: options.wide },
  );
}
