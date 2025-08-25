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
import dotenv from "dotenv";
import {
  EvaluateOptions,
  BatchEvaluateOptions,
  EvaluationResult,
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

  private getTodayDateString(): string {
    return new Date().toLocaleDateString();
  }

  private getLLMClient() {
    return this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );
  }

  private async buildSingleMessages(options: EvaluateOptions): Promise<{
    messages:
      | { role: "system"; content: string }[]
      | (
          | { role: "system"; content: string }
          | {
              role: "user";
              content:
                | string
                | (
                    | { type: "text"; text: string }
                    | {
                        type: "image_url";
                        image_url: { url: string };
                      }
                  )[];
            }
        )[];
    responseModelName: string;
  }> {
    const today = this.getTodayDateString();
    if (options.type === "screenshot") {
      const {
        question,
        systemPrompt = `You are an expert evaluator that confidently returns YES or NO given the state of a task (most times in the form of a screenshot) and a question. Provide a detailed reasoning for your answer.
          Return your response as a JSON object with the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about the question and the answer, the slightest detail might be the difference between yes and no.
          todays date is ${today}`,
        screenshotDelayMs = 1000,
      } = options;

      await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));
      const imageBuffer = await this.stagehand.page.screenshot();
      return {
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
        responseModelName: "EvaluationResult",
      };
    }

    const {
      actualText,
      expectedText,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO based on whether the actual text contains or matches the expected text.
          Return your response as a JSON object with the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          look for the key information, concepts, and meaning rather than exact wording.
          todays date is ${today}
          `,
    } = options;

    const userPrompt = `Does the actual text contain roughly the same information or meaning as the expected text?\n\nExpected: ${expectedText}\n\nActual: ${actualText}`;
    return {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      responseModelName: "TextEvaluationResult",
    };
  }

  private async buildBatchMessages(options: BatchEvaluateOptions): Promise<{
    messages:
      | { role: "system"; content: string }[]
      | (
          | { role: "system"; content: string }
          | {
              role: "user";
              content:
                | string
                | (
                    | { type: "text"; text: string }
                    | {
                        type: "image_url";
                        image_url: { url: string };
                      }
                  )[];
            }
        )[];
    responseModelName: string;
  }> {
    const today = this.getTodayDateString();
    if (options.type === "screenshot") {
      const {
        questions,
        systemPrompt = `You are an expert evaluator that confidently returns YES or NO for each question given the state of a task in the screenshot. Provide a detailed reasoning for your answer.
          Return your response as a JSON array, where each object corresponds to a question and has the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about the question and the answer, the slightest detail might be the difference between yes and no.
          todays date is ${today}`,
        screenshotDelayMs = 1000,
      } = options;

      await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));
      const imageBuffer = await this.stagehand.page.screenshot();
      const formattedQuestions = questions
        .map((q, i) => `${i + 1}. ${q}`)
        .join("\n");

      return {
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
        responseModelName: "BatchEvaluationResult",
      };
    }

    const {
      actualText,
      expectedTexts,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO for each expected text based on whether the actual text contains or matches it.
          Return your response as a JSON array, where each object corresponds to an expected text and has the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about matching - look for the key information, concepts, and meaning rather than exact wording.
          todays date is ${today}`,
    } = options;

    const formattedExpectations = expectedTexts
      .map((text, i) => `${i + 1}. ${text}`)
      .join("\n");
    const userPrompt = `For each expected text below, determine if the actual text contains roughly the same information or meaning.\n\nExpected texts:\n${formattedExpectations}\n\nActual text:\n${actualText}`;

    return {
      messages: [
        {
          role: "system",
          content: `${systemPrompt}\n\nYou will be given multiple expected texts. For each one, determine if the actual text contains or matches it. Return a single JSON array containing one object for each expected text in the order they were given.`,
        },
        { role: "user", content: userPrompt },
      ],
      responseModelName: "BatchTextEvaluationResult",
    };
  }

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

  async evaluate(options: EvaluateOptions): Promise<EvaluationResult> {
    const llmClient = this.getLLMClient();
    const { messages, responseModelName } =
      await this.buildSingleMessages(options);
    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.silentLogger,
      options: {
        messages,
        response_model: { name: responseModelName, schema: EvaluationSchema },
      },
    });

    try {
      const result = response.data as unknown as z.infer<
        typeof EvaluationSchema
      >;
      return { evaluation: result.evaluation, reasoning: result.reasoning };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        evaluation: "INVALID" as const,
        reasoning: `Failed to get structured response: ${errorMessage}`,
      };
    }
  }

  /**
   * Evaluates the current state of the page against multiple questions in a single screenshot.
   * Uses structured response generation to ensure proper format.
   * Returns an array of evaluation results.
   *
   * @param options - The options for batch screenshot evaluation
   * @returns A promise that resolves to an array of EvaluationResults
   */
  async batchEvaluate(
    options: BatchEvaluateOptions,
  ): Promise<EvaluationResult[]> {
    const llmClient = this.getLLMClient();
    const { messages, responseModelName } =
      await this.buildBatchMessages(options);
    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.silentLogger,
      options: {
        messages,
        response_model: {
          name: responseModelName,
          schema: BatchEvaluationSchema,
        },
      },
    });

    try {
      const results = response.data as unknown as z.infer<
        typeof BatchEvaluationSchema
      >;
      return results.map((r) => ({
        evaluation: r.evaluation,
        reasoning: r.reasoning,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.type === "screenshot") {
        return options.questions.map(() => ({
          evaluation: "INVALID" as const,
          reasoning: `Failed to get structured response: ${errorMessage}`,
        }));
      } else {
        return options.expectedTexts.map(() => ({
          evaluation: "INVALID" as const,
          reasoning: `Failed to get structured response: ${errorMessage}`,
        }));
      }
    }
  }
}
