import type { z } from "zod/v4";
import { LocatorCoordinatesSchema, LocatorSchema, PageLocatorSchema } from "./schemas.js";

export { ConsoleMessage } from "../../understudy/consoleMessage.js";
export type { ConsoleListener } from "../../understudy/consoleMessage.js";

export type LoadState = "load" | "domcontentloaded" | "networkidle";
export { Response } from "../../understudy/response.js";
export type LocatorCoordinates = z.infer<typeof LocatorCoordinatesSchema>;
export type PageLocator = z.infer<typeof PageLocatorSchema>;
export type Locator = z.infer<typeof LocatorSchema>;

export type SnapshotResult = {
  formattedTree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

export type PageSnapshotOptions = {
  includeIframes?: boolean;
};
