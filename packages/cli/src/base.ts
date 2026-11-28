import { Command } from "@oclif/core";

import { DriverError } from "./lib/driver/errors.js";
import { CommandFailure } from "./lib/errors.js";
import { setCliVersion } from "./lib/identity.js";
import { DISCORD_INVITE_URL, GITHUB_ISSUES_URL } from "./lib/support-links.js";
import { captureHelpLinksShown, recordCommandError } from "./lib/telemetry.js";

const SUPPORT_HINT = `Get help: ${DISCORD_INVITE_URL} · Report a bug: ${GITHUB_ISSUES_URL}`;

function isOclifError(err: Error): boolean {
  const oclifData = (err as { oclif?: { exit?: unknown } }).oclif;
  return typeof oclifData?.exit === "number";
}

function inferErrorName(err: Error): string {
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code.trim()) {
    return code;
  }
  return err.name || "Error";
}

export abstract class BrowseCommand extends Command {
  public override async init(): Promise<void> {
    await super.init();
    setCliVersion(this.config.version);
  }

  protected override async catch(err: Error & { exitCode?: number }): Promise<unknown> {
    if (err instanceof CommandFailure) {
      recordCommandError("runtime", "COMMAND_FAILURE", err.telemetry);
      process.stderr.write(`${err.message}\n`);
      this.exit(err.exitCode);
    }

    if (err instanceof DriverError) {
      recordCommandError("runtime", "DRIVER_ERROR", {
        resultCode: err.code,
        httpStatus: err.httpStatus,
      });
      process.stderr.write(`${SUPPORT_HINT}\n`);
      process.stderr.write(`    DriverError: ${err.message}\n`);
      process.stderr.write(`    Code: ${err.code}\n`);
      this.exit(1);
    }

    if (!isOclifError(err)) {
      process.stderr.write(`${SUPPORT_HINT}\n`);

      await captureHelpLinksShown(this.config.version, {
        source: "error_hint",
        error_type: inferErrorName(err),
      });
    }

    return super.catch(err);
  }
}
