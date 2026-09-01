import { DriverError } from "../errors.js";
import type { DriverCommandHandler } from "./types.js";

export const unavailableCursorOverlay: DriverCommandHandler = async () => {
  throw new DriverError(
    "The visible cursor overlay has not been restored in this Stagehand V4 stack layer.",
    { code: "cursor_overlay_unavailable" },
  );
};
