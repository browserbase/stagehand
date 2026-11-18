import { Command } from "@oclif/core";

import { CommandFailure } from "./lib/errors.js";
import { setCliVersion } from "./lib/identity.js";
import { DISCORD_INVITE_URL, GITHUB_ISSUES_URL } from "./lib/support-links.js";
import { recordCommandError } from "./lib/telemetry.js";

const SUPPORT_HINT = `Get help: ${DISCORD_INVITE_URL} · Report a bug: ${GITHUB_ISSUES_URL}`;

function isOclifError(err: Error): boolean {
  const oclifData = (err as { oclif?: { exit?: unknown } }).oclif;
  return typeof oclifData?.exit === "number";
}

export abstract class BrowseCommand extends Command {
  public override async init(): Promise<void> {
    await super.init();
    // Seed the CLI version from oclif's Config (the single source of truth) so
    // non-command contexts — remote session userMetadata and cloud API headers
    // — can stamp the real version without any filesystem read. This runs in
    // every process before run(), including the background `browse daemon` that
    // creates Browserbase sessions, so cli_version never regresses to "unknown".
    setCliVersion(this.config.version);
  }

  protected override async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    if (err instanceof CommandFailure) {
      recordCommandError("runtime", "COMMAND_FAILURE", err.telemetry);
      process.stderr.write(`${err.message}\n`);
      this.exit(err.exitCode);
    }

    // For unexpected runtime errors (not oclif validation/usage errors),
    // print a support hint before the default error handling.
    if (!isOclifError(err)) {
      process.stderr.write(`${SUPPORT_HINT}\n`);
    }

    return super.catch(err);
  }
}
