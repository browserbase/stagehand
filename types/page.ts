import type {
  Browser as PuppeteerBrowser,
  BrowserContext as PuppeteerContext,
  Page as PuppeteerPage,
} from "puppeteer-core";
import { z } from "zod";
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

export interface Page extends Omit<PuppeteerPage, "on"> {
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
  } & PuppeteerPage["on"];
}

// Using Puppeteer browser context type
export type BrowserContext = PuppeteerContext;

// Using Puppeteer browser type
export type Browser = PuppeteerBrowser;
