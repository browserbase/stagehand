import { Errors, type Hook } from "@oclif/core";

import { suggestCommand } from "../lib/command-suggestions.js";
import { captureCommandNotFound } from "../lib/telemetry.js";

function toSpaced(commandId: string): string {
  return commandId.replaceAll(":", " ");
}

const hook: Hook.CommandNotFound = async function ({ config, id }) {
  let attempted = "";
  let suggestion: string | null = null;

  try {
    const commandIds = config.commands
      .filter((command) => !command.hidden)
      .map((command) => command.id);
    const result = suggestCommand(id, commandIds);
    attempted = result.attempted;
    suggestion = result.suggestion;
    if (
      suggestion &&
      !config.findCommand(suggestion) &&
      !config.findTopic(suggestion)
    ) {
      // Guards against alias targets drifting out of the command tree.
      suggestion = null;
    }

    const displayAttempted = toSpaced(attempted || (id.split(":")[0] ?? id));
    const didYouMean = suggestion
      ? ` Did you mean "${config.bin} ${toSpaced(suggestion)}"?`
      : "";
    process.stderr.write(
      `"${config.bin} ${displayAttempted}" is not a ${config.bin} command.${didYouMean} Run ${config.bin} --help for all commands.\n`,
    );
  } catch {
    // Suggestions are best-effort and must never mask the not-found error.
  }

  try {
    // Awaited so the event is delivered before the process exits; the
    // transport aborts after a short timeout, so this cannot hang the CLI.
    await captureCommandNotFound(config.version, attempted || null, suggestion);
  } catch {
    // Best-effort telemetry should never affect CLI behavior.
  }

  // Re-throw oclif's standard not-found error. Returning normally from a
  // command_not_found hook makes oclif treat the invocation as handled
  // (exit 0), so this throw preserves the default error and exit code 2.
  throw new Errors.CLIError(`command ${id} not found`);
};

export default hook;
