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
  BatchAskOptions,
  EvaluationResult,
} from "@/types/evaluator";
import { LLMParsedResponse } from "@/lib/inference";
import { LLMResponse } from "@/lib/llm/LLMClient";
import { LogLine } from "@/types/log";
import { z } from "zod/v3";
import { imageResize } from "./utils/imageUtils";

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
      apiKey: process.env.GEMINI_API_KEY || "",
    };
  }

  async ask(options: EvaluateOptions): Promise<EvaluationResult> {
    const {
      question,
      answer,
      screenshot = true,
      systemPrompt,
      screenshotDelayMs = 250,
      agentReasoning,
    } = options;
    if (!question) {
      throw new Error("Question cannot be an empty string");
    }
    if (!answer && !screenshot) {
      throw new Error("Either answer (text) or screenshot must be provided");
    }

    // Handle multiple screenshots case
    if (Array.isArray(screenshot)) {
      return this._evaluateWithMultipleScreenshots({
        question,
        screenshots: screenshot,
        systemPrompt,
        agentReasoning,
      });
    }

    // Single screenshot case (existing logic)
    const defaultSystemPrompt = `You are an expert evaluator that confidently returns YES or NO based on if the original goal was achieved. You have access to  ${screenshot ? "a screenshot" : "the agents reasoning and actions throughout the task"} that you can use to evaluate the tasks completion. Provide detailed reasoning for your answer.
          Today's date is ${new Date().toLocaleDateString()}`;

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
          { role: "system", content: systemPrompt || defaultSystemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: agentReasoning
                  ? `Question: ${question}\n\nAgent's reasoning and actions taken:\n${agentReasoning}`
                  : question,
              },
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
   * Evaluates multiple questions with optional answers and/or screenshot.
   * Similar to ask() but processes multiple questions in a single call.
   * Returns an array of evaluation results.
   *
   * @param options - The options for batch evaluation
   * @returns A promise that resolves to an array of EvaluationResults
   */
  async batchAsk(options: BatchAskOptions): Promise<EvaluationResult[]> {
    const {
      questions,
      screenshot = true,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO for each question given the state of a task based on the original goal. You have access to  ${screenshot ? "a screenshot" : "the agents reasoning and actions throughout the task"} that you can use to evaluate the tasks completion. Provide detailed reasoning for your answer.
          Today's date is ${new Date().toLocaleDateString()}`,
      screenshotDelayMs = 1000,
    } = options;

    // Validate inputs
    if (!questions || questions.length === 0) {
      throw new Error("Questions array cannot be empty");
    }

    for (const item of questions) {
      if (!item.question) {
        throw new Error("Question cannot be an empty string");
      }
      if (!item.answer && !screenshot) {
        throw new Error(
          "Either answer (text) or screenshot must be provided for each question",
        );
      }
    }

    // Wait for the specified delay before taking screenshot
    await new Promise((resolve) => setTimeout(resolve, screenshotDelayMs));

    let imageBuffer: Buffer;
    if (screenshot) {
      imageBuffer = await this.stagehand.page.screenshot();
    }

    // Get the LLM client with our preferred model
    const llmClient = this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );

    // Format all questions with their optional answers
    const formattedQuestions = questions
      .map((item, i) => {
        let text = `${i + 1}. ${item.question}`;
        if (item.answer) {
          text += `\n   Answer: ${item.answer}`;
        }
        return text;
      })
      .join("\n\n");

    // Use the model-specific LLM client to evaluate
    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.silentLogger,
      options: {
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\n\nYou will be given multiple questions${screenshot ? " with a screenshot" : ""}. ${questions.some((q) => q.answer) ? "Some questions include answers to evaluate." : ""} Answer each question by returning an object in the specified JSON format. Return a single JSON array containing one object for each question in the order they were asked.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: formattedQuestions },
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

  /**
   * Private method to evaluate with multiple screenshots
   */
  private async _evaluateWithMultipleScreenshots(options: {
    question: string;
    screenshots: Buffer[];
    systemPrompt?: string;
    agentReasoning?: string;
  }): Promise<EvaluationResult> {
    const {
      question,
      screenshots,
      agentReasoning,
      systemPrompt = `You are an expert evaluator that confidently returns YES or NO given a question and multiple screenshots showing the progression of a task.
        ${agentReasoning ? "You also have access to the agent's detailed reasoning and thought process throughout the task." : ""}
        Analyze ALL screenshots to understand the complete journey. Look for evidence of task completion across all screenshots, not just the last one.
        Success criteria may appear at different points in the sequence (confirmation messages, intermediate states, etc).
        ${agentReasoning ? "The agent's reasoning provides crucial context about what actions were attempted, what was observed, and the decision-making process. Use this alongside the visual evidence to make a comprehensive evaluation." : ""}
        Today's date is ${new Date().toLocaleDateString()}`,
    } = options;

    if (!question) {
      throw new Error("Question cannot be an empty string");
    }

    if (!screenshots || screenshots.length === 0) {
      throw new Error("At least one screenshot must be provided");
    }

    const llmClient = this.stagehand.llmProvider.getClient(
      this.modelName,
      this.modelClientOptions,
    );

    const lastScreenshot = await this.stagehand.page.screenshot();

    const allScreenshots = [...screenshots, lastScreenshot];
    //Downsize screenshots:
    const downsizedScreenshots = await Promise.all(
      allScreenshots.map(async (screenshot) => {
        return await imageResize(screenshot, 0.7);
      }),
    );

    const imageContents = downsizedScreenshots.map((screenshot) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/png;base64,${screenshot.toString("base64")}`,
      },
    }));

    const response = await llmClient.createChatCompletion<
      LLMParsedResponse<LLMResponse>
    >({
      logger: this.stagehand.logger,
      options: {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: agentReasoning
                  ? `Question: ${question}\n\nAgent's reasoning and actions throughout the task:\n${agentReasoning}\n\nI'm providing ${screenshots.length} screenshots showing the progression of the task. Please analyze both the agent's reasoning and all screenshots to determine if the task was completed successfully.`
                  : `${question}\n\nI'm providing ${screenshots.length} screenshots showing the progression of the task. Please analyze all of them to determine if the task was completed successfully.`,
              },
              ...imageContents,
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
}
