import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { attachFunctionSecret } from "../../../lib/secrets/api.js";

export default class FunctionSecretsAttach extends BrowseCommand {
  static override description =
    "Attach an existing project secret to a function.";
  static override examples = [
    "browse functions secrets attach <functionId> <secretId>",
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
    const { args, flags } = await this.parse(FunctionSecretsAttach);
    const options = toApiOptions(flags);
    await attachFunctionSecret(options, args.functionId, args.secretId);
  }
}
