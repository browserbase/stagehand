export interface TokenUsage {
  functionName: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface TokenUsageResult {
  _stagehandTokenUsage?: TokenUsage;
}
