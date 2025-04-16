/**
 * This class is responsible for evaluating the result of an agentic task.
 * The first version includes a VLM evaluator specifically prompted to evaluate the state of a task
 * usually represented as a screenshot.
 * The evaluator will reply with YES or NO given the state of the provided task.
 */

import { AvailableModel, ClientOptions, Stagehand } from "@/dist";
import dotenv from "dotenv";

dotenv.config();

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

export class Evaluator {
  private stagehand: Stagehand;
  private modelName: AvailableModel;
  private modelClientOptions: ClientOptions | { apiKey: string };
  // Define regex patterns directly in the class or as constants if preferred elsewhere
  private yesPattern = /^(YES|Y|TRUE|CORRECT|AFFIRMATIVE)/i;
  private noPattern = /^(NO|N|FALSE|INCORRECT|NEGATIVE)/i;

  constructor(
    stagehand: Stagehand,
    modelName?: AvailableModel,
    modelClientOptions?: ClientOptions,
  ) {
    this.stagehand = stagehand;
    this.modelName = modelName || "gemini-2.0-flash";
    this.modelClientOptions = modelClientOptions || {
      apiKey: process.env.GOOGLE_API_KEY || "",
    };
  }

  /**
   * Evaluates the current state of the page against a specific question.
   * Expects a JSON object response: { "evaluation": "YES" | "NO", "reasoning": "..." }
   * Returns the evaluation result with normalized response and success status.
   *
   * @param options - The options for evaluation
   * @returns A promise that resolves to an EvaluationResult
   * @throws Error if strictResponse is true and response is not clearly YES or NO, or if JSON parsing/validation fails.
   */
  async evaluate(options: EvaluateOptions): Promise<EvaluationResult> {
    const {
      question,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO given the state of a task (most times in the form of a screenshot) and a question. Provide a detailed reasoning for your answer.
          Return your response as a JSON object with the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }`,
      screenshotDelayMs = 1000,
      strictResponse = false,
    } = options;

    await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));
    const imageBuffer = await this.stagehand.page.screenshot();
    const llmClient = this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );

    const response = await llmClient.createChatCompletion({
      logger: () => {},
      options: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        image: { buffer: imageBuffer },
      },
    });

    const rawResponse = response.choices[0].message.content;
    let evaluationResult: "YES" | "NO" | "INVALID" = "INVALID";
    let reasoning = `Failed to process response. Raw response: ${rawResponse}`;

    try {
      // Clean potential markdown fences
      const cleanedResponse = rawResponse
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "")
        .trim();

      // Attempt to parse the JSON object
      const parsedResult: { evaluation: unknown; reasoning: unknown } =
        JSON.parse(cleanedResponse);

      // Validate structure
      if (
        typeof parsedResult !== "object" ||
        parsedResult === null ||
        typeof parsedResult.evaluation !== "string" ||
        typeof parsedResult.reasoning !== "string"
      ) {
        throw new Error(
          `Invalid JSON structure received: ${JSON.stringify(parsedResult)}`,
        );
      }

      const evaluationString = parsedResult.evaluation.trim().toUpperCase();
      reasoning = parsedResult.reasoning.trim(); // Update reasoning from parsed object

      // Use regex patterns to validate the evaluation string
      const isYes = this.yesPattern.test(evaluationString);
      const isNo = this.noPattern.test(evaluationString);

      if (isYes) {
        evaluationResult = "YES";
      } else if (isNo) {
        evaluationResult = "NO";
      } else {
        // Parsed JSON but evaluation value wasn't YES/NO variant
        if (strictResponse) {
          throw new Error(
            `Invalid evaluation value in JSON: ${parsedResult.evaluation}`,
          );
        }
        // Keep INVALID, reasoning already updated
        reasoning = `Invalid evaluation value: ${parsedResult.evaluation}. Reasoning: ${reasoning}`;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Failed during evaluation processing:", errorMessage);
      // Update reasoning with error details
      reasoning = `Processing error: ${errorMessage}. Raw response: ${rawResponse}`;
      if (strictResponse) {
        // Re-throw error if in strict mode
        throw new Error(reasoning);
      }
      // Keep evaluationResult as "INVALID"
    }

    return {
      evaluation: evaluationResult,
      reasoning: reasoning,
    };
  }

  /**
   * Evaluates the current state of the page against multiple questions in a single screenshot.
   * Returns an array of evaluation results.
   *
   * @param options - The options for batch evaluation
   * @returns A promise that resolves to an array of EvaluationResults
   * @throws Error if strictResponse is true and any response is not clearly YES or NO
   */
  async batchEvaluate(
    options: BatchEvaluateOptions,
  ): Promise<EvaluationResult[]> {
    const {
      questions,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO for each question given the state of a task in the screenshot. Provide a detailed reasoning for your answer.
          Return your response as a JSON array, where each object corresponds to a question and has the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }`,
      screenshotDelayMs = 1000,
      strictResponse = false,
    } = options;

    // Wait for the specified delay before taking screenshot
    await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));

    // Take a screenshot of the current page state
    const imageBuffer = await this.stagehand.page.screenshot();

    // Create a numbered list of questions for the VLM
    const formattedQuestions = questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n");

    // Get the LLM client with our preferred model
    const llmClient = this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );

    // Use the model-specific LLM client to evaluate the screenshot with all questions
    const response = await llmClient.createChatCompletion({
      logger: () => {},
      options: {
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\n\nYou will be given multiple questions. Answer each question by returning an object in the specified JSON format. Return a single JSON array containing one object for each question in the order they were asked.`,
          },
          {
            role: "user",
            content: formattedQuestions,
          },
        ],
        image: {
          buffer: imageBuffer,
        },
      },
    });

    const rawResponse = response.choices[0].message.content;
    const finalResults: EvaluationResult[] = [];

    try {
      // Clean potential markdown fences
      const cleanedResponse = rawResponse
        .replace(/^```json\s*/, "")
        .replace(/\s*```$/, "")
        .trim();

      // Attempt to parse the JSON array
      const parsedResults: { evaluation: unknown; reasoning: unknown }[] =
        JSON.parse(cleanedResponse);

      if (!Array.isArray(parsedResults)) {
        throw new Error("Response is not a JSON array.");
      }

      if (parsedResults.length !== questions.length && strictResponse) {
        // Optional: Log a warning even if not strict?
        // console.warn(`LLM returned ${parsedResults.length} results, but ${questions.length} questions were asked.`);
        throw new Error(
          `Expected ${questions.length} results, but got ${parsedResults.length}`,
        );
      }

      for (let i = 0; i < questions.length; i++) {
        if (i < parsedResults.length) {
          const item = parsedResults[i];
          // Ensure item is an object and has the required properties
          if (
            typeof item !== "object" ||
            item === null ||
            typeof item.evaluation !== "string" ||
            typeof item.reasoning !== "string"
          ) {
            if (strictResponse) {
              throw new Error(
                `Invalid object structure for question ${i + 1}: ${JSON.stringify(item)}`,
              );
            }
            finalResults.push({
              evaluation: "INVALID",
              reasoning: `Invalid object structure received: ${JSON.stringify(
                item,
              )}`,
            });
            continue; // Move to the next question
          }

          // Use regex patterns for validation
          const evaluationString = item.evaluation.trim().toUpperCase();
          const reasoning = item.reasoning.trim();
          const isYes = this.yesPattern.test(evaluationString);
          const isNo = this.noPattern.test(evaluationString);

          if (isYes) {
            finalResults.push({ evaluation: "YES", reasoning: reasoning });
          } else if (isNo) {
            finalResults.push({ evaluation: "NO", reasoning: reasoning });
          } else {
            // Invalid evaluation value
            if (strictResponse) {
              throw new Error(
                `Invalid evaluation value for question ${i + 1}: ${item.evaluation}`,
              );
            }
            finalResults.push({
              evaluation: "INVALID",
              reasoning: `Invalid evaluation value: ${item.evaluation}. Reasoning: ${reasoning}`,
            });
          }
        } else {
          // Missing result for this question
          if (strictResponse) {
            throw new Error(`No response found for question ${i + 1}`);
          }
          finalResults.push({
            evaluation: "INVALID",
            reasoning: "No response found for this question.",
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Failed to parse LLM response as JSON:", errorMessage);
      // If JSON parsing fails or structure is wrong, handle based on strictResponse
      if (strictResponse) {
        throw new Error(
          `Failed to parse LLM response or invalid format: ${rawResponse}. Error: ${errorMessage}`,
        );
      }
      // Fallback: return INVALID for all questions
      finalResults.length = 0; // Clear any potentially partially filled results
      for (let i = 0; i < questions.length; i++) {
        finalResults.push({
          evaluation: "INVALID",
          reasoning: `Failed to parse response. Raw response: ${rawResponse}. Error: ${errorMessage}`,
        });
      }
    }

    return finalResults;
  }
}
