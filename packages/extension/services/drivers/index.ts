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

export function llmDrivers(options: { logActTiming?: boolean } = {}): Drivers {
  return {
    act: llmActDriver(),
    observe: llmObserveDriver(),
    extract: llmExtractDriver(),
    logActTiming: options.logActTiming === true,
  };
}

export function decisionDrivers(config: DecisionsConfig): Drivers {
  const llmFallback = config.llmFallback !== false;
  const act = decisionsActDriver(config);
  const observe = decisionsObserveDriver(config);
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
