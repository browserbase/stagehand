import { StagehandResultUsageSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { CacheMetadata, StagehandResultUsage } from "@browserbasehq/stagehand-protocol/types";

export function zeroStagehandResultUsage(): StagehandResultUsage {
  return StagehandResultUsageSchema.parse({});
}

export function disabledCacheMetadata(): CacheMetadata {
  return { status: "DISABLED" };
}
