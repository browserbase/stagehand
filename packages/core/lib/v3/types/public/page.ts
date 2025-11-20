import { z } from "zod";
import { Page } from "../../understudy/page";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page as PuppeteerPage } from "puppeteer-core";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage, Page };

export const pageHandleSchema = z.object({
  pageId: z.string().min(1),
  targetId: z.string().min(1),
});

export interface PageHandle {
  pageId: string;
  targetId: string;
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
