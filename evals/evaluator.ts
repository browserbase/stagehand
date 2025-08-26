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
  }

  async ask(options: EvaluateOptions): Promise<EvaluationResult> {
    const {
      question,
      answer,
      screenshot = true,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO given a question and the state of a task (in the form of a screenshot, or an answer). Provide a detailed reasoning for your answer.
          Be critical about the question and the answer, the slightest detail might be the difference between yes and no.
          Today's date is ${new Date().toLocaleDateString()}`,
      screenshotDelayMs = 250,
    } = options;
    if (!question) {
      throw new Error("Question cannot be an empty string");
    }
    if (!answer && !screenshot) {
      throw new Error("Either answer (text) or screenshot must be provided");
    }

    await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));
    let imageBuffer: Buffer;
    if (screenshot) {
      imageBuffer = await this.stagehand.page.screenshot();
    }
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
              ...(screenshot
                ? [
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                      },
                    },
                  ]
                : []),
              ...(answer
                ? [
                    {
                      type: "text",
                      text: `the answer is ${answer}`,
                    },
                  ]
                : []),
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
    if (options.type === "screenshot") {
      const {
        questions,
        systemPrompt = `You are an expert evaluator that confidently returns YES or NO for each question given the state of a task in the screenshot. Provide a detailed reasoning for your answer.
          Return your response as a JSON array, where each object corresponds to a question and has the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about the question and the answer, the slightest detail might be the difference between yes and no.
          todays date is ${new Date().toLocaleDateString()}`,
        screenshotDelayMs = 1000,
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
        return results.map((r) => ({
          evaluation: r.evaluation,
          reasoning: r.reasoning,
        }));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return questions.map(() => ({
          evaluation: "INVALID" as const,
          reasoning: `Failed to get structured response: ${errorMessage}`,
        }));
      }
    }

    // Text batch branch
    const {
      actualText,
      expectedTexts,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO for each expected text based on whether the actual text contains or matches it.
          Return your response as a JSON array, where each object corresponds to an expected text and has the following format:
          { "evaluation": "YES" | "NO", "reasoning": "detailed reasoning for your answer" }
          Be critical about matching - look for the key information, concepts, and meaning rather than exact wording.
          todays date is ${new Date().toLocaleDateString()}`,
    } = options;

    const formattedExpectations = expectedTexts
      .map((text, i) => `${i + 1}. ${text}`)
      .join("\n");

    const llmClient = this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );

    const userPrompt = `For each expected text below, determine if the actual text contains roughly the same information or meaning.\n\nExpected texts:\n${formattedExpectations}\n\nActual text:\n${actualText}`;

    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.silentLogger,
      options: {
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\n\nYou will be given multiple expected texts. For each one, determine if the actual text contains or matches it. Return a single JSON array containing one object for each expected text in the order they were given.`,
          },
          { role: "user", content: userPrompt },
        ],
        response_model: {
          name: "BatchTextEvaluationResult",
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
      return expectedTexts.map(() => ({
        evaluation: "INVALID" as const,
        reasoning: `Failed to get structured response: ${errorMessage}`,
      }));
    }
  }
}
