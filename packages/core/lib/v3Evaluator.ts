/**
 * V3Evaluator mirrors Evaluator but operates on a V3 instance instead of Stagehand.
 * It uses the V3 page/screenshot APIs and constructs an LLM client to run
 * structured evaluations (YES/NO with reasoning) on screenshots and/or text.
 */

import { z } from "zod";
import type { AvailableModel, ClientOptions } from "./v3/types/public/model.js";
import type {
  EvaluateOptions,
  BatchAskOptions,
  EvaluationResult,
} from "./v3/types/private/evaluator.js";
import { LLMParsedResponse } from "./inference.js";
import { LLMResponse, LLMClient } from "./v3/llm/LLMClient.js";
import { LogLine } from "./v3/types/public/logs.js";
import { V3 } from "./v3/v3.js";
import { LLMProvider } from "./v3/llm/LLMProvider.js";
import { StagehandInvalidArgumentError } from "./v3/types/public/sdkErrors.js";

const EvaluationSchema = z.object({
  evaluation: z.enum(["YES", "NO"]),
  reasoning: z.string(),
});

const BatchEvaluationSchema = z.array(EvaluationSchema);

export class V3Evaluator {
  private v3: V3;
  private modelName: AvailableModel;
  private modelClientOptions: ClientOptions | { apiKey: string };
  private silentLogger: (message: LogLine) => void = () => {};

  constructor(
    v3: V3,
    modelName?: AvailableModel,
    modelClientOptions?: ClientOptions,
  ) {
    this.v3 = v3;
    this.modelName = modelName || ("google/gemini-2.5-flash" as AvailableModel);
    this.modelClientOptions = modelClientOptions || {
      apiKey:
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        "",
    };
  }

  private getClient(): LLMClient {
    // Prefer a dedicated provider so we can override model per-evaluation
    const provider = new LLMProvider(this.v3.logger);
    return provider.getClient(this.modelName, this.modelClientOptions);
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
    if (!question)
      throw new StagehandInvalidArgumentError(
        "Question cannot be an empty string",
      );
    if (!answer && !screenshot)
      throw new StagehandInvalidArgumentError(
        "Either answer (text) or screenshot must be provided",
      );

    if (Array.isArray(screenshot)) {
      return this._evaluateWithMultipleScreenshots({
        question,
        screenshots: screenshot,
        systemPrompt,
        agentReasoning,
      });
    }

    const defaultSystemPrompt = `You are an expert evaluator that confidently returns YES or NO based on if the original goal was achieved. You have access to  ${screenshot ? "a screenshot" : "the agents reasoning and actions throughout the task"} that you can use to evaluate the tasks completion. Provide detailed reasoning for your answer.\n          Today's date is ${new Date().toLocaleDateString()}`;

    await new Promise((r) => setTimeout(r, screenshotDelayMs));
    let imageBuffer: Buffer | undefined;
    if (screenshot) {
      const page = await this.v3.context.awaitActivePage();
      imageBuffer = await page.screenshot({ fullPage: false });
    }

    const llmClient = this.getClient();

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
              ...(screenshot && imageBuffer
                ? [
                    {
                      type: "image_url" as const,
                      image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                      },
                    },
                  ]
                : []),
              ...(answer
                ? [{ type: "text" as const, text: `the answer is ${answer}` }]
                : []),
            ],
          },
        ],
        response_model: { name: "EvaluationResult", schema: EvaluationSchema },
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
        evaluation: "INVALID",
        reasoning: `Failed to get structured response: ${errorMessage}`,
      } as const;
    }
  }

  async batchAsk(options: BatchAskOptions): Promise<EvaluationResult[]> {
    const {
      questions,
      screenshot = true,
      systemPrompt = "You are an expert evaluator that returns YES or NO with a concise reasoning.",
      screenshotDelayMs = 250,
    } = options;
    if (!questions?.length)
      throw new StagehandInvalidArgumentError(
        "Questions array cannot be empty",
      );

    await new Promise((r) => setTimeout(r, screenshotDelayMs));
    let imageBuffer: Buffer | undefined;
    if (screenshot) {
      const page = await this.v3.context.awaitActivePage();
      imageBuffer = await page.screenshot({ fullPage: false });
    }

    const llmClient = this.getClient();

    const formatted = questions
      .map(
        (item, i) =>
          `${i + 1}. ${item.question}${item.answer ? `\n   Answer: ${item.answer}` : ""}`,
      )
      .join("\n\n");

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
              { type: "text", text: formatted },
              ...(screenshot && imageBuffer
                ? [
                    {
                      type: "image_url" as const,
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

    if (!question)
      throw new StagehandInvalidArgumentError(
        "Question cannot be an empty string",
      );
    if (!screenshots || screenshots.length === 0)
      throw new StagehandInvalidArgumentError(
        "At least one screenshot must be provided",
      );

    const llmClient = this.getClient();

    const imageContents = screenshots.map((s) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${s.toString("base64")}` },
    }));

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
        response_model: { name: "EvaluationResult", schema: EvaluationSchema },
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
        evaluation: "INVALID",
        reasoning: `Failed to get structured response: ${errorMessage}`,
      } as const;
    }
  }
}
