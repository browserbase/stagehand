import { Command } from "@oclif/core";

import { CommandFailure } from "./lib/errors.js";
import { recordCommandError } from "./lib/telemetry.js";

export abstract class BrowseCommand extends Command {
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
