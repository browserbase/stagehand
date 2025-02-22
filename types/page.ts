import type {
  Browser as PlaywrightBrowser,
  BrowserContext as PlaywrightContext,
  Page as PlaywrightPage,
} from "@playwright/test";
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

  observe(): Promise<ObserveResult[]>;
  observe(instruction: string): Promise<ObserveResult[]>;
  observe(options?: ObserveOptions): Promise<ObserveResult[]>;

  on: {
    (event: "popup", listener: (page: Page) => unknown): Page;
  } & PlaywrightPage["on"];

  saveScreenshot(options?: {
    path?: string;
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<string>;
}

// Empty type for now, but will be used in the future
export type BrowserContext = PlaywrightContext;

// Empty type for now, but will be used in the future
export type Browser = PlaywrightBrowser;
