import { Page as PlaywrightPage } from "@playwright/test";
import { ActResult } from "./act";
import { ActOptions } from "./stagehand";

export interface Page extends PlaywrightPage {
  act: (options: ActOptions) => Promise<ActResult>;
}
