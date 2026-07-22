/**
 * Context type for bench tasks ported to the Stagehand v4 SDK.
 *
 * Deliberately mirrors BenchTaskContext (types.ts) so per-task diffs between
 * the v3 and v4 suites stay 1:1, with the v3 surface swapped for the v4 one:
 * `v3` → `stagehand`, Playwright `page` → v4 `Page`. Keeping `page` typed as
 * the v4 Page makes any Playwright API usage in a ported task a type error.
 */
import type { AvailableModel } from "@browserbasehq/stagehand";
import type {
  Page,
  Stagehand,
} from "@browserbasehq/stagehand-v4-spike-sdk-ts";
import type { EvalLogger } from "../logger.js";

export interface BenchV4TaskContext {
  /** Stagehand v4 client instance. */
  stagehand: Stagehand;
  /** v4 page object (RPC-backed — url()/title() are async). */
  page: Page;
  /** Eval logger. Note: the v4 SDK itself logs to the console, not here. */
  logger: EvalLogger;
  /** Full eval input (name, modelName, params). */
  input: {
    name: string;
    modelName: AvailableModel;
    params?: Record<string, unknown>;
  };
  /** Model used for this run. */
  modelName: AvailableModel;
  /** Debug URL (unavailable from the v4 SDK — always empty for now). */
  debugUrl: string;
  /** Session URL (Browserbase; constructed from the session ID). */
  sessionUrl: string;
}
