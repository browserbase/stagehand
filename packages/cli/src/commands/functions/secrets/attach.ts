import { functionIdArg, secretIdArg } from "../../../lib/secrets/args.js";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { attachFunctionSecret } from "../../../lib/secrets/api.js";

export default class FunctionSecretsAttach extends BrowseCommand {
  static override description =
    "Attach an existing project secret to a function.";
  static override examples = [
    "browse functions secrets attach <functionId> <secretId>",
    "browse functions secrets attach 7b6e1c42-8d93-4a15-b2f0-9c6d3e8a5041 d2c4f48f-38e9-4b82-a36a-2b373fd14a65",
  ];
  static override args = {
    functionId: functionIdArg,
    secretId: secretIdArg,
  };
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionSecretsAttach);
    const options = toApiOptions(flags);
    await attachFunctionSecret(options, args.functionId, args.secretId);
  }
}
