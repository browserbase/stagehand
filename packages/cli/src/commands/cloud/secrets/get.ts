import { secretIdArg } from "../../../lib/cloud/args.js";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { getSecret } from "../../../lib/secrets/api.js";
import { outputJson } from "../../../lib/output.js";

export default class SecretsGet extends BrowseCommand {
  static override description =
    "Get project secret metadata. Does not return the secret value.";
  static override examples = [
    "browse cloud secrets get <secretId>",
    "browse cloud secrets get d2c4f48f-38e9-4b82-a36a-2b373fd14a65",
  ];
  static override args = {
    secretId: secretIdArg,
  };
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsGet);
    const options = toApiOptions(flags);
    outputJson(await getSecret(options, args.secretId));
  }
}
