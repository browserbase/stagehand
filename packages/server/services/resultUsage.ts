import { StagehandResultUsageSchema } from "../../protocol/schemas.js";
import type { StagehandResultUsage } from "../../protocol/types.js";

export function zeroStagehandResultUsage(): StagehandResultUsage {
  return StagehandResultUsageSchema.parse({});
}
