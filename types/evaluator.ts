export interface EvaluateScreenshotOptions {
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
}

export interface BatchEvaluateScreenshotOptions {
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
   * The reasoning behind the evaluation
   */
  reasoning?: string;
}

export interface EvaluateTextOptions {
  /**
   * The actual text/message to evaluate
   */
  actualText: string;
  /**
   * The expected text or pattern to check against
   */
  expectedText: string;
  /**
   * Custom system prompt for the evaluator
   */
  systemPrompt?: string;
}

export interface BatchEvaluateTextOptions {
  /**
   * The actual text/message to evaluate
   */
  actualText: string;
  /**
   * Array of expected texts or patterns to check against
   */
  expectedTexts: string[];
  /**
   * Custom system prompt for the evaluator
   */
  systemPrompt?: string;
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
