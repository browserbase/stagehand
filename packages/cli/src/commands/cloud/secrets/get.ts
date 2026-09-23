import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { getSecret } from "../../../lib/secrets/api.js";
import { outputJson } from "../../../lib/output.js";

export default class SecretsGet extends BrowseCommand {
  static override description =
    "Get project secret metadata. Does not return the secret value.";
  static override examples = ["browse cloud secrets get <secretId>"];
  static override args = {
    secretId: Args.string({
      description: "Project secret ID.",
      required: true,
    }),
  };
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsGet);
    const options = toApiOptions(flags);
    outputJson(await getSecret(options, args.secretId));
  }
}
