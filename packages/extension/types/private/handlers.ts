import { Page } from "../../understudy/page.js";
import type { z } from "zod/v4";
import type { ModelConfiguration, Variables } from "../../../protocol/types.js";
import type { StagehandLogger } from "../../logger.js";

export interface ActHandlerParams {
  instruction: string;
  model?: ModelConfiguration;
  variables?: Variables;
  timeout?: number;
  page: Page;
  logger: StagehandLogger;
}

export interface ExtractHandlerParams<T extends z.ZodType> {
  instruction?: string;
  schema?: T;
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  ignoreSelectors?: string[];
  screenshot?: boolean;
  page: Page;
  logger: StagehandLogger;
}

export interface ObserveHandlerParams {
  instruction?: string;
  model?: ModelConfiguration;
  variables?: Variables;
  timeout?: number;
  selector?: string;
  ignoreSelectors?: string[];
  page: Page;
  logger: StagehandLogger;
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
