import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { listSecrets } from "../../../lib/secrets/api.js";
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

export default class SecretsList extends BrowseCommand {
  static override description =
    "List project secret metadata with cursor pagination.";
  static override examples = [
    "browse cloud secrets list",
    "browse cloud secrets list --start-at 2026-01-01T00:00:00Z",
    "browse cloud secrets list --start-at 2026-01-01T00:00:00Z --end-at 2026-02-01T00:00:00Z",
    "browse cloud secrets list --limit 10",
  ];
  static override flags = { ...apiCommonFlags, ...collectionSecretsFlags };
  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsList);
    validateSecretsCollectionFlags(flags);
    const options = toApiOptions(flags);
    if (usesCollectionContract(flags)) {
      const query = toListSecretsOptions(flags);
      await outputCollection({
        flags,
        source: {
          kind: "cursor",
          pageSize: 1000,
          loadPage: (page) => listSecrets(options, { ...query, ...page }),
        },
        table: (items) => outputSecretsTable(items, flags),
      });
      return;
    }
    outputJson(await listSecrets(options, toListSecretsOptions(flags)));
  }
}
