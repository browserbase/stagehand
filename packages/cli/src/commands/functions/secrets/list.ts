import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { listFunctionSecrets } from "../../../lib/secrets/api.js";
import {
  listSecretsFlags,
  toListSecretsOptions,
} from "../../../lib/secrets/flags.js";
import { outputJson } from "../../../lib/output.js";

export default class FunctionSecretsList extends BrowseCommand {
  static override description =
    "List metadata for secrets attached to a function.";
  static override examples = ["browse functions secrets list <functionId>"];
  static override args = {
    functionId: Args.string({ description: "Function ID.", required: true }),
  };
  static override flags = { ...apiCommonFlags, ...listSecretsFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(FunctionSecretsList);
    const options = toApiOptions(flags);
    outputJson(
      await listFunctionSecrets(
        options,
        args.functionId,
        toListSecretsOptions(flags),
      ),
    );
  }
}
