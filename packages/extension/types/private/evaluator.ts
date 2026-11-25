export type EvaluateOptions = {
  question: string;
  answer?: string;
  screenshot?: boolean | Uint8Array[];
  systemPrompt?: string;
  screenshotDelayMs?: number;
  agentReasoning?: string;
};

export type BatchAskOptions = {
  questions: Array<{
    question: string;
    answer?: string;
  }>;
  screenshot?: boolean;
  systemPrompt?: string;
  screenshotDelayMs?: number;
};

export interface EvaluationResult {
  evaluation: "YES" | "NO" | "INVALID";
  reasoning: string;
}
