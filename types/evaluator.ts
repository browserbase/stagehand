export interface EvaluateOptions {
  /**
   * The question to ask about the task state
   */
  question: string;
  /**
   * Custom system prompt for the evaluator
   */
  systemPrompt?: string;
  /**
   * Delay in milliseconds before taking the screenshot
   * @default 1000
   */
  screenshotDelayMs?: number;
  /**
   * Whether to throw an error if the response is not a clear YES or NO
   * @default false
   */
  strictResponse?: boolean;
}

export interface BatchEvaluateOptions {
  /**
   * Array of questions to evaluate
   */
  questions: string[];
  /**
   * Custom system prompt for the evaluator
   */
  systemPrompt?: string;
  /**
   * Delay in milliseconds before taking the screenshot
   * @default 1000
   */
  screenshotDelayMs?: number;
  /**
   * Whether to throw an error if any response is not a clear YES or NO
   * @default false
   */
  strictResponse?: boolean;
  /**
   * The reasoning behind the evaluation
   */
  reasoning?: string;
}

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
