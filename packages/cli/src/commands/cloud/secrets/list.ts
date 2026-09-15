import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { listSecrets } from "../../../lib/secrets/api.js";
import {
  listSecretsFlags,
  toListSecretsOptions,
} from "../../../lib/secrets/flags.js";
import { outputJson } from "../../../lib/output.js";

export default class SecretsList extends BrowseCommand {
  static override description =
    "List project secret metadata with cursor pagination.";
  static override examples = ["browse cloud secrets list"];
  static override flags = { ...apiCommonFlags, ...listSecretsFlags };
  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsList);
    const options = toApiOptions(flags);
    outputJson(await listSecrets(options, toListSecretsOptions(flags)));
  }
}
