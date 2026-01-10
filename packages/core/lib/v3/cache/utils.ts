import { Page } from "../understudy/page";
import type {
  AgentCacheContext,
  AgentReplayStep,
  CachedAgentEntry,
} from "../types/private";
import type { AgentResult } from "../types/public";

export function cloneForCache<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function safeGetPageUrl(page: Page): Promise<string> {
  try {
    return page.url();
  } catch {
    return "";
  }
}

interface CreateCachedAgentEntryParams {
  context: AgentCacheContext;
  steps: AgentReplayStep[];
  result: AgentResult;
}

export function createCachedAgentEntry({
  context,
  steps,
  result,
}: CreateCachedAgentEntryParams): CachedAgentEntry {
  return {
    version: 1,
    instruction: context.instruction,
    startUrl: context.startUrl,
    options: context.options,
    configSignature: context.configSignature,
    steps: cloneForCache(steps),
    result: pruneAgentResultForCache(result),
    timestamp: new Date().toISOString(),
  };
}

export function pruneAgentResultForCache(result: AgentResult): AgentResult {
  const cloned = cloneForCache(result);
  if (!Array.isArray(cloned.actions)) {
    return cloned;
  }

  for (const action of cloned.actions) {
    if (action?.type === "screenshot") {
      delete action.base64;
    }
  }

  return cloned;
}
