import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { deleteSecret } from "../../../lib/secrets/api.js";

export default class SecretsDelete extends BrowseCommand {
  static override description = "Delete a project secret.";
  static override examples = ["browse cloud secrets delete <secretId>"];
  static override args = {
    secretId: Args.string({
      description: "Project secret ID.",
      required: true,
    }),
  };
  static override flags = { ...apiCommonFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsDelete);
    const options = toApiOptions(flags);
    await deleteSecret(options, args.secretId);
  }
}
