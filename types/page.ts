import type { Page as PlaywrightPage } from "@playwright/test";
import type { BrowserContext as PlaywrightContext } from "@playwright/test";
import type { ActResult } from "./act";
import type {
  ActOptions,
  ExtractOptions,
  ExtractResult,
  ObserveOptions,
  ObserveResult,
} from "./stagehand";
import type { z } from "zod";
export interface Page extends PlaywrightPage {
  act: (options: ActOptions) => Promise<ActResult>;
  extract: <T extends z.AnyZodObject>(
    options: ExtractOptions<T>,
  ) => Promise<ExtractResult<T>>;
  observe: (options?: ObserveOptions) => Promise<ObserveResult[]>;
}

// Empty type for now, but will be used in the future
export type BrowserContext = PlaywrightContext;
