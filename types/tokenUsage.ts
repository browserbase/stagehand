import { LLMUsageEntry } from "./model";

export interface WithTokenUsage {
  _stagehandTokenUsage?: LLMUsageEntry;
}
