import { StagehandResultUsageSchema } from "../../protocol/schemas.js";
import type { CacheMetadata, StagehandResultUsage } from "../../protocol/types.js";

export function zeroStagehandResultUsage(): StagehandResultUsage {
  return StagehandResultUsageSchema.parse({});
}

/**
 * The cache metadata a result carries when no cache lookup ran at all —
 * caching off, no Browserbase session, or a path that bypasses the cache.
 * Services start every result here; withCache overwrites it when it runs.
 */
export function disabledCacheMetadata(): CacheMetadata {
  return { status: "DISABLED" };
}
