import { Page } from "../../understudy/page";
import { ModelConfiguration } from "../public/model";
import type { StagehandZodSchema } from "../../zodCompat";

export interface ActHandlerParams {
  instruction: string;
  model?: ModelConfiguration;
  variables?: Record<string, string>;
  timeout?: number;
  page: Page;
}

export interface ExtractHandlerParams<T extends StagehandZodSchema> {
  instruction?: string;
  schema?: T;
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page: Page;
}

export interface ObserveHandlerParams {
  instruction?: string;
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page: Page;
}

// We can use this enum to list the actions supported in performPlaywrightMethod
export enum SupportedPlaywrightAction {
  CLICK = "click",
  FILL = "fill",
  TYPE = "type",
  PRESS = "press",
  SCROLL = "scrollTo",
  NEXT_CHUNK = "nextChunk",
  PREV_CHUNK = "prevChunk",
  SELECT_OPTION_FROM_DROPDOWN = "selectOptionFromDropdown",
  HOVER = "hover",
}
