import { Page } from "../../understudy/page";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page as PuppeteerPage } from "puppeteer-core";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage, Page };
export type AnyPage = PlaywrightPage | PuppeteerPage | PatchrightPage | Page;

export { ConsoleMessage } from "../../understudy/consoleMessage";
export type { ConsoleListener } from "../../understudy/consoleMessage";

export type LoadState = "load" | "domcontentloaded" | "networkidle";
export { StagehandResponse } from "../../understudy/stagehandResponse";
