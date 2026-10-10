import { secretIdArg } from "../../../lib/cloud/args.js";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { deleteSecret } from "../../../lib/secrets/api.js";

export default class SecretsDelete extends BrowseCommand {
  static override description = "Delete a project secret.";
  static override examples = [
    "browse cloud secrets delete <secretId>",
    "browse cloud secrets delete d2c4f48f-38e9-4b82-a36a-2b373fd14a65",
  ];
  static override args = {
    secretId: secretIdArg,
  };
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsDelete);
    const options = toApiOptions(flags);
    await deleteSecret(options, args.secretId);
  }
}
