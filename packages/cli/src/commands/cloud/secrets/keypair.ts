import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { getSecretKeypair } from "../../../lib/secrets/api.js";
import { outputJson } from "../../../lib/output.js";

export default class SecretsKeypair extends BrowseCommand {
  static override description =
    "Get the project public encryption key and keypair ID.";
  static override examples = ["browse cloud secrets keypair"];
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsKeypair);
    const options = toApiOptions(flags);
    outputJson(await getSecretKeypair(options));
  }
}
