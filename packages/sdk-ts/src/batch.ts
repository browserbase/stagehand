import type { Page } from "@browserbasehq/stagehand-shared-object-model/page";

export type {
  ExperimentalBatchBrowserContext,
  ExperimentalBatchExtractOptions,
  ExperimentalBatchContext,
  ExperimentalBatchCallback,
} from "@browserbasehq/stagehand-shared-object-model/batch";

export type ExperimentalBatchOptions = {
  /** Page exposed as `batch.page`. AI operations still default to the active page. */
  page?: Page;
  /**
   * Overall callback deadline in milliseconds, enforced by the browser-side
   * executor. The client waits `CALLBACK_BATCH_CLIENT_GRACE_MS` beyond it for
   * the response. That local deadline fires when the executor never answers
   * at all (stalled navigation, hung service worker), which the browser-side
   * `timeout` cannot cover.
   */
  timeout?: number;
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
