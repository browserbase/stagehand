import { DriverError } from "../errors.js";
import type { DriverCommandHandler, DriverCommandName } from "./types.js";

export function unavailableV4Command(
  command: DriverCommandName,
): DriverCommandHandler {
  return async () => {
    throw new DriverError(
      `The \`${command}\` command has not been migrated to Stagehand V4 in this stack layer.`,
      { code: "v4_command_unavailable" },
    );
  };
}

export const unavailableCursorOverlay: DriverCommandHandler = async () => {
  throw new DriverError(
    "The visible cursor overlay has not been restored in this Stagehand V4 stack layer.",
    { code: "cursor_overlay_unavailable" },
  );
};
