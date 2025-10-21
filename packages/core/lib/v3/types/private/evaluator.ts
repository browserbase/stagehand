export type EvaluateOptions = {
  /** The question to ask about the task state */
  question: string;
  /** The answer to the question */
  answer?: string;
  /** Whether to take a screenshot of the task state, or array of screenshots to evaluate */
  screenshot?: boolean | Buffer[];
  /** Custom system prompt for the evaluator */
  systemPrompt?: string;
  /** Delay in milliseconds before taking the screenshot @default 250 */
  screenshotDelayMs?: number;
  /** The agent's reasoning/thought process for completing the task */
  agentReasoning?: string;
};

export type BatchAskOptions = {
  /** Array of questions with optional answers */
  questions: Array<{
    question: string;
    answer?: string;
  }>;
  /** Whether to take a screenshot of the task state */
  screenshot?: boolean;
  /** Custom system prompt for the evaluator */
  systemPrompt?: string;
  /** Delay in milliseconds before taking the screenshot @default 1000 */
  screenshotDelayMs?: number;
};

/**
 * Result of an evaluation
 */
export interface EvaluationResult {
  /**
   * The evaluation result ('YES', 'NO', or 'INVALID' if parsing failed or value was unexpected)
   */
  evaluation: "YES" | "NO" | "INVALID";
  /**
   * The reasoning behind the evaluation
   */
  reasoning: string;
}
