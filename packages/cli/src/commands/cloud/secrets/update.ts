import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { updateSecret } from "../../../lib/secrets/api.js";
import { readSecretValue } from "../../../lib/secrets/input.js";
import { secretInputFlags } from "../../../lib/secrets/flags.js";
import { outputJson } from "../../../lib/output.js";

export default class SecretsUpdate extends BrowseCommand {
  static override description =
    "Replace a secret value, encrypting it locally with the current project public key.";
  static override examples = [
    "browse cloud secrets update <secretId> --stdin < ./secret.txt",
  ];
  static override args = {
    secretId: Args.string({
      description: "Project secret ID.",
      required: true,
    }),
  };
  static override flags = { ...apiCommonFlags, ...secretInputFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsUpdate);
    const options = toApiOptions(flags);
    const value = await readSecretValue({ stdin: flags.stdin });
    try {
      outputJson(await updateSecret(options, args.secretId, value));
    } finally {
      value.fill(0);
    }
  }
}
