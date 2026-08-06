import type { Action, ActResult, ObserveResult } from "../../protocol/types.js";
import type { BrowserContext } from "./browserContext.js";
import type {
  StagehandClientActOptions,
  StagehandClientExtractOptions,
  StagehandClientObserveOptions,
} from "./clientSchemas.js";
import type { Page } from "./page.js";

export type ExperimentalBatchOptions = {
  page?: Page;
  /** Overall callback deadline in milliseconds. */
  timeout?: number;
};

export type ExperimentalBatchBrowserContext = Omit<
  BrowserContext,
  "close" | "rpcClient" | "clipboardRef"
>;
export type ExperimentalBatchExtractOptions = Omit<StagehandClientExtractOptions, "page">;

export type ExperimentalBatchContext = {
  page: Page;
  context: ExperimentalBatchBrowserContext;
  act(
    instruction: string | Action,
    options?: Omit<StagehandClientActOptions, "page">,
  ): Promise<ActResult>;
  observe(
    instruction?: string,
    options?: Omit<StagehandClientObserveOptions, "page">,
  ): Promise<ObserveResult>;
  extract(instruction: string, options?: ExperimentalBatchExtractOptions): Promise<unknown>;
  extract(
    instruction: string,
    schema: unknown,
    options?: ExperimentalBatchExtractOptions,
  ): Promise<unknown>;
  metrics(): Promise<unknown>;
};

export type ExperimentalBatchCallback<Input, Result> = (
  stagehand: ExperimentalBatchContext,
  input: Input,
) => Result | Promise<Result>;
