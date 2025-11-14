export interface StagehandMetrics {
  actPromptTokens: number;
  actCompletionTokens: number;
  actReasoningTokens: number;
  actInferenceTimeMs: number;
  extractPromptTokens: number;
  extractCompletionTokens: number;
  extractReasoningTokens: number;
  extractInferenceTimeMs: number;
  observePromptTokens: number;
  observeCompletionTokens: number;
  observeReasoningTokens: number;
  observeInferenceTimeMs: number;
  agentPromptTokens: number;
  agentCompletionTokens: number;
  agentReasoningTokens: number;
  agentInferenceTimeMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number;
  totalInferenceTimeMs: number;
}
