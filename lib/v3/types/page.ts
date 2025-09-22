import type {
  Browser as PlaywrightBrowser,
  BrowserContext as PlaywrightContext,
  Page as PlaywrightPage,
} from "playwright";
import { z } from "zod/v3";
import type {
  ActOptions,
  ActResult,
  ExtractOptions,
  ExtractResult,
  ObserveOptions,
  ObserveResult,
} from "./stagehand";

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const pageTextSchema = z.object({
  page_text: z.string(),
});

export interface Page extends Omit<PlaywrightPage, "on"> {
  act(action: string): Promise<ActResult>;
  act(options: ActOptions): Promise<ActResult>;
  act(observation: ObserveResult): Promise<ActResult>;

  extract(
    instruction: string,
  ): Promise<ExtractResult<typeof defaultExtractSchema>>;
  extract<T extends z.AnyZodObject>(
    options: ExtractOptions<T>,
  ): Promise<ExtractResult<T>>;
  extract(): Promise<ExtractResult<typeof pageTextSchema>>;

  observe(): Promise<ObserveResult[]>;
  observe(instruction: string): Promise<ObserveResult[]>;
  observe(options?: ObserveOptions): Promise<ObserveResult[]>;

  on: {
    (event: "popup", listener: (page: Page) => unknown): Page;
  } & PlaywrightPage["on"];
}

// Empty type for now, but will be used in the future
export type BrowserContext = PlaywrightContext;

// Empty type for now, but will be used in the future
export type Browser = PlaywrightBrowser;
