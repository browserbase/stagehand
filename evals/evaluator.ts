/**
 * This class is responsible for evaluating the result of an agentic task.
 * The first version includes a VLM evaluator specifically prompted to evaluate the state of a task
 * usually represented as a screenshot.
 * The evaluator will reply with YES or NO given the state of the provided task.
 */

import {
  AvailableModel,
  ClientOptions,
  Stagehand,
} from "@browserbasehq/stagehand";
import { LLMResponseError } from "@/types/stagehandErrors";
import dotenv from "dotenv";
import {
  EvaluateOptions,
  EvaluationResult,
  BatchEvaluateOptions,
} from "@/types/evaluator";
import { LLMParsedResponse } from "@/lib/inference";
import { LLMResponse } from "@/lib/llm/LLMClient";
import { LogLine } from "@/types/log";
import { z } from "zod";

dotenv.config();

const EvaluationSchema = z.object({
  evaluation: z.enum(["YES", "NO"]),
  reasoning: z.string(),
});

const BatchEvaluationSchema = z.array(EvaluationSchema);

export class Evaluator {
  private stagehand: Stagehand;
  private modelName: AvailableModel;
  private modelClientOptions: ClientOptions | { apiKey: string };
  private silentLogger: (message: LogLine) => void;

  constructor(
    stagehand: Stagehand,
    modelName?: AvailableModel,
    modelClientOptions?: ClientOptions,
  ) {
    this.stagehand = stagehand;
    this.modelName = modelName || "google/gemini-2.5-flash";
    this.modelClientOptions = modelClientOptions || {
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
    };
    // Create a silent logger function that doesn't output anything
    this.silentLogger = () => {};
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
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about the question and the answer, the slightest detail might be the difference between yes and no.`,
      screenshotDelayMs = 1000,
      strictResponse = false,
    } = options;

    await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));
    const imageBuffer = await this.stagehand.page.screenshot();
    const llmClient = this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );

    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.silentLogger,
      options: {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: question },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                },
              },
            ],
          },
        ],
        response_model: {
          name: "EvaluationResult",
          schema: EvaluationSchema,
        },
      },
    });

    try {
      const result = response.data as unknown as z.infer<
        typeof EvaluationSchema
      >;

      return {
        evaluation: result.evaluation,
        reasoning: result.reasoning,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (strictResponse) {
        throw new LLMResponseError(
          "Evaluator",
          `Failed to get structured response: ${errorMessage}`,
        );
      }

      return {
        evaluation: "INVALID" as const,
        reasoning: `Failed to get structured response: ${errorMessage}`,
      };
    }
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
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about the question and the answer, the slightest detail might be the difference between yes and no.`,
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
    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.silentLogger,
      options: {
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\n\nYou will be given multiple questions. Answer each question by returning an object in the specified JSON format. Return a single JSON array containing one object for each question in the order they were asked.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: formattedQuestions },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                },
              },
            ],
          },
        ],
        response_model: {
          name: "BatchEvaluationResult",
          schema: BatchEvaluationSchema,
        },
      },
    });

    try {
      const results = response.data as unknown as z.infer<
        typeof BatchEvaluationSchema
      >;

      if (results.length !== questions.length && strictResponse) {
        throw new LLMResponseError(
          "Evaluator",
          `Expected ${questions.length} results, but got ${results.length}`,
        );
      }

      // Pad with INVALID results if we got fewer than expected
      const finalResults: EvaluationResult[] = [];
      for (let i = 0; i < questions.length; i++) {
        if (i < results.length) {
          finalResults.push({
            evaluation: results[i].evaluation,
            reasoning: results[i].reasoning,
          });
        } else {
          finalResults.push({
            evaluation: "INVALID",
            reasoning: "No response found for this question.",
          });
        }
      }

      return finalResults;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (strictResponse) {
        throw new LLMResponseError(
          "Evaluator",
          `Failed to get structured response: ${errorMessage}`,
        );
      }

      // Fallback: return INVALID for all questions
      return questions.map(() => ({
        evaluation: "INVALID" as const,
        reasoning: `Failed to get structured response: ${errorMessage}`,
      }));
    }
  }
}
