export interface StagehandMetrics {
  actPromptTokens: number;
  actCompletionTokens: number;
  actReasoningTokens: number;
  actCachedInputTokens: number;
  actInferenceTimeMs: number;
  extractPromptTokens: number;
  extractCompletionTokens: number;
  extractReasoningTokens: number;
  extractCachedInputTokens: number;
  extractInferenceTimeMs: number;
  observePromptTokens: number;
  observeCompletionTokens: number;
  observeReasoningTokens: number;
  observeCachedInputTokens: number;
  observeInferenceTimeMs: number;
  agentPromptTokens: number;
  agentCompletionTokens: number;
  agentReasoningTokens: number;
  agentCachedInputTokens: number;
  agentInferenceTimeMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number;
  totalCachedInputTokens: number;
  totalInferenceTimeMs: number;
}
