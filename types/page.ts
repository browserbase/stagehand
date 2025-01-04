import type {
  Browser as PlaywrightBrowser,
  BrowserContext as PlaywrightContext,
  Page as PlaywrightPage,
} from "@playwright/test";
import type { z } from "zod";
import type {
  ActOptions,
  ActResult,
  ExtractOptions,
  ExtractResult,
  ObserveOptions,
  ObserveResult,
} from "./stagehand";

export interface Page extends PlaywrightPage {
  act: (options: ActOptions) => Promise<ActResult>;
  extract: <T extends z.AnyZodObject>(
    options: ExtractOptions<T>,
  ) => Promise<ExtractResult<T>>;
  observe: (options?: ObserveOptions) => Promise<ObserveResult[]>;
}

// Empty type for now, but will be used in the future
export type BrowserContext = PlaywrightContext;

// Empty type for now, but will be used in the future
export type Browser = PlaywrightBrowser;
