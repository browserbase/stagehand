import type {
  Action,
  ActResult,
  ObserveResult,
  StagehandMetrics,
} from "@browserbasehq/stagehand-protocol/types";
import type { BrowserContext } from "./browserContext.js";
import type {
  StagehandClientActOptions,
  StagehandClientExtractOptions,
  StagehandClientObserveOptions,
} from "./objectModelSchemas.js";
import type { Page } from "./page.js";

export type ExperimentalBatchBrowserContext = Omit<
  BrowserContext,
  "close" | "rpcClient" | "clipboardRef"
>;
export type ExperimentalBatchExtractOptions = StagehandClientExtractOptions;

export type ExperimentalBatchContext = {
  /** Page selected when the batch starts; this does not change the default target of AI operations. */
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
  batch: ExperimentalBatchContext,
  input: Input,
) => Result | Promise<Result>;
