import { z } from "zod/v3";
import { Page } from "../../understudy/page";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page as PuppeteerPage } from "puppeteer-core";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage, Page };

export const pageHandleSchema = z.object({
  pageId: z.string().min(1),
  mainFrameId: z.string().min(1),
});

export interface PageHandle {
  pageId: string;
  mainFrameId: string;
}

export type AnyPage =
  | PlaywrightPage
  | PuppeteerPage
  | PatchrightPage
  | Page
  | PageHandle;

export { ConsoleMessage } from "../../understudy/consoleMessage";
export type { ConsoleListener } from "../../understudy/consoleMessage";

export type LoadState = "load" | "domcontentloaded" | "networkidle";
export { Response } from "../../understudy/response";
