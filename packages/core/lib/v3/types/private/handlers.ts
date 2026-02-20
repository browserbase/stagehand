import { Page } from "../../understudy/page.js";
import { ModelConfiguration } from "../public/model.js";
import type { StagehandZodSchema } from "../../zodCompat.js";
import type { Variables } from "../public/agent.js";

export interface ActHandlerParams {
  instruction: string;
  model?: ModelConfiguration;
  variables?: Variables;
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

// We can use this enum to list the actions supported in performUnderstudyMethod
export enum SupportedUnderstudyAction {
  CLICK = "click",
  FILL = "fill",
  TYPE = "type",
  PRESS = "press",
  SCROLL = "scrollTo",
  NEXT_CHUNK = "nextChunk",
  PREV_CHUNK = "prevChunk",
  SELECT_OPTION_FROM_DROPDOWN = "selectOptionFromDropdown",
  HOVER = "hover",
  DOUBLE_CLICK = "doubleClick",
  DRAG_AND_DROP = "dragAndDrop",
}
