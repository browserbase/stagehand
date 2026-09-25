import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { listFunctionSecrets } from "../../../lib/secrets/api.js";
import {
  collectionSecretsFlags,
  toListSecretsOptions,
} from "../../../lib/secrets/flags.js";
import { outputJson } from "../../../lib/output.js";
import {
  usesCollectionContract,
  outputCollection,
} from "../../../lib/collections.js";
import {
  outputSecretsTable,
  validateSecretsCollectionFlags,
} from "../../../lib/secrets/output.js";

export default class FunctionSecretsList extends BrowseCommand {
  static override description =
    "List metadata for secrets attached to a function with cursor pagination.";
  static override examples = [
    "browse functions secrets list <functionId>",
    "browse functions secrets list 7b6e1c42-8d93-4a15-b2f0-9c6d3e8a5041",
    "browse functions secrets list <functionId> --start-at 2026-01-01T00:00:00Z",
    "browse functions secrets list <functionId> --start-at 2026-01-01T00:00:00Z --end-at 2026-02-01T00:00:00Z",
    "browse functions secrets list <functionId> --limit 10",
  ];
  static override args = {
    functionId: Args.string({
      description: "Function ID (e.g. 7b6e1c42-8d93-4a15-b2f0-9c6d3e8a5041).",
      required: true,
    }),
  };
  static override flags = { ...apiCommonFlags, ...collectionSecretsFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionSecretsList);
    validateSecretsCollectionFlags(flags);
    const options = toApiOptions(flags);
    if (usesCollectionContract(flags)) {
      const query = toListSecretsOptions(flags);
      await outputCollection({
        flags,
        source: {
          kind: "cursor",
          pageSize: 1000,
          loadPage: (page) =>
            listFunctionSecrets(options, args.functionId, {
              ...query,
              ...page,
            }),
        },
        table: (items) => outputSecretsTable(items, flags),
      });
      return;
    }
    outputJson(
      await listFunctionSecrets(
        options,
        args.functionId,
        toListSecretsOptions(flags),
      ),
    );
  }
}
