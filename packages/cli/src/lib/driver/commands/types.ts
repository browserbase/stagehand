import type { DriverSessionManager } from "../session-manager.js";
import { z } from "zod";

export const DRIVER_COMMAND_NAMES = [
  "back",
  "click",
  "cursor",
  "eval",
  "fill",
  "forward",
  "get",
  "highlight",
  "is",
  "key",
  "mouse.click",
  "mouse.drag",
  "mouse.hover",
  "mouse.scroll",
  "network.clear",
  "network.off",
  "network.on",
  "network.path",
  "open",
  "refs",
  "reload",
  "screenshot",
  "select",
  "snapshot",
  "tab.close",
  "tab.list",
  "tab.new",
  "tab.switch",
  "type",
  "upload",
  "viewport",
  "wait",
] as const;

export const DriverCommandNameSchema = z.enum(DRIVER_COMMAND_NAMES);

export type DriverCommandName = z.infer<typeof DriverCommandNameSchema>;

export type DriverCommandHandler = (
  manager: DriverSessionManager,
  params: unknown,
) => Promise<unknown>;

export type DriverCommandHandlers = Partial<
  Record<DriverCommandName, DriverCommandHandler>
>;
