import { Page as PatchrightPage } from "patchright-core";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PuppeteerPage } from "puppeteer-core";
import { Page } from "../../understudy/page";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage, Page };

export type AnyPage = PlaywrightPage | PuppeteerPage | PatchrightPage | Page;

export { ConsoleMessage } from "../../understudy/consoleMessage";
export type { ConsoleListener } from "../../understudy/consoleMessage";

export type LoadState = "load" | "domcontentloaded" | "networkidle";
export { Response } from "../../understudy/response";
