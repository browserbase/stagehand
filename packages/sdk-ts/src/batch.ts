import type { Action, ActResult, ObserveResult, StagehandMetrics } from "../../protocol/types.js";
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
export type ExperimentalBatchExtractOptions = StagehandClientExtractOptions;

export type ExperimentalBatchContext = {
  page: Page;
  context: ExperimentalBatchBrowserContext;
  act(instruction: string | Action, options?: StagehandClientActOptions): Promise<ActResult>;
  observe(instruction?: string, options?: StagehandClientObserveOptions): Promise<ObserveResult>;
  extract(instruction: string, options?: ExperimentalBatchExtractOptions): Promise<unknown>;
  extract(
    instruction: string,
    schema: unknown,
    options?: ExperimentalBatchExtractOptions,
  ): Promise<unknown>;
  metrics(): Promise<StagehandMetrics>;
};

export type ExperimentalBatchCallback<Input, Result> = (
  stagehand: ExperimentalBatchContext,
  input: Input,
) => Result | Promise<Result>;
