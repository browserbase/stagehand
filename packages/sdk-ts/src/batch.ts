import type { Action, ActResult, ObserveResult, StagehandMetrics } from "../../protocol/types.js";
import type { BrowserContext } from "./browserContext.js";
import type {
  StagehandClientActOptions,
  StagehandClientExtractOptions,
  StagehandClientObserveOptions,
} from "./clientSchemas.js";
import type { Page } from "./page.js";

export type ExperimentalBatchOptions = {
  /** Page exposed as `batch.page`. AI operations still default to the active page. */
  page?: Page;
  /** Overall callback deadline in milliseconds, enforced by the browser-side executor. */
  timeout?: number;
  /**
   * Local deadline for the whole round trip in milliseconds. Defaults to
   * `timeout + CALLBACK_BATCH_CLIENT_GRACE_MS`. It fires when the executor never
   * answers at all (stalled navigation, hung service worker), which the
   * browser-side `timeout` cannot cover.
   */
  clientTimeoutMs?: number;
};

/** Slack the client grants the executor to report its own `timeout` before giving up locally. */
export const CALLBACK_BATCH_CLIENT_GRACE_MS = 15_000;

/**
 * The batch round trip exceeded its client-side deadline. The executor may
 * still be running the callback; the browser session should be treated as
 * unresponsive rather than retried blindly.
 */
export class StagehandBatchTimeoutError extends Error {
  readonly timeout: number;
  readonly clientTimeout: number;

  constructor(details: { timeout: number; clientTimeout: number }, options?: ErrorOptions) {
    super(
      `stagehand.experimentalBatch() received no response within ${details.clientTimeout}ms (callback timeout ${details.timeout}ms)`,
      options,
    );
    this.name = "StagehandBatchTimeoutError";
    this.timeout = details.timeout;
    this.clientTimeout = details.clientTimeout;
  }
}

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
