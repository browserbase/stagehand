import { Args } from "@oclif/core";
import { BrowseCommand } from "../../../base.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { createSecret } from "../../../lib/secrets/api.js";
import { readSecretValue } from "../../../lib/secrets/input.js";
import { secretInputFlags } from "../../../lib/secrets/flags.js";
import { outputJson } from "../../../lib/output.js";

export default class SecretsCreate extends BrowseCommand {
  static override description =
    "Create a project secret. Encrypts the value locally with the project public key.";
  static override examples = [
    "browse cloud secrets create SERVICE_TOKEN",
    "browse cloud secrets create SERVICE_TOKEN --env MY_SERVICE_TOKEN",
    "browse cloud secrets create SERVICE_TOKEN --stdin < ./secret.txt",
  ];
  static override args = {
    key: Args.string({
      description: "Name exposed in the function context.secrets object.",
      required: true,
    }),
  };
  static override flags = { ...apiCommonFlags, ...secretInputFlags };
  async run(): Promise<void> {
    const { args, flags } = await this.parse(SecretsCreate);
    const options = toApiOptions(flags);
    const value = await readSecretValue({ stdin: flags.stdin, env: flags.env });
    try {
      outputJson(await createSecret(options, args.key, value));
    } finally {
      value.fill(0);
    }
  }
}
