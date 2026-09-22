import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { detachFunctionSecret } from "../../../lib/secrets/api.js";

export default class FunctionSecretsDetach extends BrowseCommand {
  static override description =
    "Detach a secret from a function without deleting the secret.";
  static override examples = [
    "browse functions secrets detach <functionId> <secretId>",
  ];
  static override args = {
    functionId: Args.string({ description: "Function ID.", required: true }),
    secretId: Args.string({
      description: "Project secret ID.",
      required: true,
    }),
  };
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionSecretsDetach);
    const options = toApiOptions(flags);
    await detachFunctionSecret(options, args.functionId, args.secretId);
  }
}
