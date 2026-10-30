import { Command } from "@oclif/core";

import { CommandFailure } from "./lib/errors.js";
import { setCliVersion } from "./lib/identity.js";
import { recordCommandError } from "./lib/telemetry.js";

export abstract class BrowseCommand extends Command {
  public override async init(): Promise<void> {
    await super.init();
    const setupModule = "./lib/setup/config.js";
    const setup = await import(setupModule).catch(
      (error: NodeJS.ErrnoException) => {
        // The local-only build omits setup and saved cloud credentials.
        if (
          error.code !== "ERR_MODULE_NOT_FOUND" ||
          !/[\\/]lib[\\/]setup[\\/]config\.js/.test(error.message)
        )
          throw error;
        return undefined;
      },
    );
    await setup?.loadSetupEnvironment();
    // Seed the CLI version from oclif's Config (the single source of truth) so
    // non-command contexts — remote session userMetadata and cloud API headers
    // — can stamp the real version without any filesystem read. This runs in
    // every process before run(), including the background `browse daemon` that
    // creates Browserbase sessions, so cli_version never regresses to "unknown".
    setCliVersion(this.config.version);
  }

  protected override async catch(
    err: Error & { exitCode?: number },
  ): Promise<unknown> {
    if (err instanceof CommandFailure) {
      recordCommandError("runtime", "COMMAND_FAILURE", err.telemetry);
      process.stderr.write(`${err.message}\n`);
      this.exit(err.exitCode);
    }

    return super.catch(err);
  }
}
