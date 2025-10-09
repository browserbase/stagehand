import { Page } from "../understudy/page";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page as PuppeteerPage } from "puppeteer-core";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage };
export type AnyPage = PlaywrightPage | PuppeteerPage | PatchrightPage | Page;

export type LoadState = "load" | "domcontentloaded" | "networkidle";

export interface GotoOptions {
  timeout?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  referer?: string;
  frameId?: string;
}
