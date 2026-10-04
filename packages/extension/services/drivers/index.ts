import {
  decisionsActDriver,
  decisionsCachedActionGuard,
  decisionsCompletionJudge,
  decisionsExtractDriver,
  decisionsObserveDriver,
} from "../decisions/drivers.js";
import type { DecisionsConfig } from "../decisions/config.js";
import {
  actOrFail,
  actWithFallback,
  extractOrFail,
  extractWithFallback,
  observeOrFail,
  observeWithFallback,
} from "./fallback.js";
import { llmActDriver, llmExtractDriver, llmObserveDriver } from "./llm/index.js";
import type { Drivers } from "./types.js";

export type * from "./types.js";

/**
 * The composition root: the two ways Stagehand's AI methods are wired. Anything else, a test
 * double or a third driver family, is another function returning `Drivers`.
 */

/** act(), observe() and extract() resolved by the configured language model. */
export function llmDrivers(options: { logActTiming?: boolean } = {}): Drivers {
  return {
    act: llmActDriver(),
    observe: llmObserveDriver(),
    extract: llmExtractDriver(),
    logActTiming: options.logActTiming === true,
  };
}

/**
 * The decision model first, the language model whenever it abstains. With `llmFallback: false`
 * an abstention is a visible failure instead, which shows what the decision model alone gets
 * wrong.
 */
export function decisionDrivers(config: DecisionsConfig): Drivers {
  const llmFallback = config.llmFallback !== false;
  const act = decisionsActDriver(config);
  const observe = decisionsObserveDriver(config);
  // Whenever the language model extracts here, the decision model judges completion for it.
  const llmExtract = llmExtractDriver({ completionJudge: decisionsCompletionJudge(config) });
  const pick = decisionsExtractDriver(config, { gateOnCompletion: llmFallback });

  return {
    act: llmFallback ? actWithFallback(act, llmActDriver()) : actOrFail(act),
    observe: llmFallback
      ? observeWithFallback(observe, llmObserveDriver())
      : observeOrFail(observe),
    extract:
      config.extract === "judge"
        ? llmExtract
        : llmFallback
          ? extractWithFallback(pick, llmExtract)
          : extractOrFail(pick),
    ...(config.cacheCheck ? { cachedActionGuard: decisionsCachedActionGuard(config) } : {}),
    logActTiming: true,
  };
}
