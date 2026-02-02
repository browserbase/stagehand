/**
 * Standalone evaluator for Agent SDK-based skills.
 * Uses an LLM (default: Gemini) to judge task completion based on screenshots and reasoning.
 */

import { z } from "zod";
import * as ai from "ai";
import { wrapAISDK } from "braintrust";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const { generateObject } = wrapAISDK(ai);

const EvaluationSchema = z.object({
  evaluation: z.enum(["YES", "NO"]),
  reasoning: z.string(),
});

export type EvaluationResult = z.infer<typeof EvaluationSchema> | {
  evaluation: "INVALID";
  reasoning: string;
};

export interface SkillsEvaluatorOptions {
  modelName?: string;
  apiKey?: string;
}

export interface EvaluateOptions {
  question: string;
  screenshots?: Buffer[];
  agentReasoning?: string;
  systemPrompt?: string;
}

export class SkillsEvaluator {
  private modelName: string;
  private apiKey: string;

  constructor(options: SkillsEvaluatorOptions = {}) {
    this.apiKey =
      options.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      "";

    if (!this.apiKey) {
      throw new Error(
        "GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is required for SkillsEvaluator"
      );
    }

    this.modelName = options.modelName || "gemini-2.5-flash";
  }

  private getModel() {
    const google = createGoogleGenerativeAI({
      apiKey: this.apiKey,
    });
    return google(this.modelName);
  }

  /**
   * Evaluate task completion based on screenshots and/or agent reasoning.
   */
  async evaluate(options: EvaluateOptions): Promise<EvaluationResult> {
    const { question, screenshots, agentReasoning, systemPrompt } = options;

    if (!question) {
      return {
        evaluation: "INVALID",
        reasoning: "Question cannot be empty",
      };
    }

    if (!screenshots?.length && !agentReasoning) {
      return {
        evaluation: "INVALID",
        reasoning: "Either screenshots or agentReasoning must be provided",
      };
    }

    const defaultSystemPrompt = `You are an expert evaluator that confidently returns YES or NO based on whether the original goal was achieved.
You have access to ${screenshots?.length ? `${screenshots.length} screenshots showing the progression of the task` : "the agent's reasoning and actions"}.
Provide detailed reasoning for your answer.
Today's date is ${new Date().toLocaleDateString()}.`;

    try {
      // Build the prompt content
      const contentParts: Array<{ type: "text"; text: string } | { type: "image"; image: Buffer }> = [];

      // Add the question and agent reasoning
      let questionText = `Question: ${question}`;
      if (agentReasoning) {
        questionText += `\n\nAgent's reasoning and actions throughout the task:\n${agentReasoning}`;
      }
      if (screenshots?.length) {
        questionText += `\n\nI'm providing ${screenshots.length} screenshots showing the progression of the task. Please analyze all of them to determine if the task was completed successfully.`;
      }
      contentParts.push({ type: "text", text: questionText });

      // Add screenshots as images
      if (screenshots?.length) {
        for (const screenshot of screenshots) {
          contentParts.push({
            type: "image",
            image: screenshot,
          });
        }
      }

      const model = this.getModel();

      const result = await generateObject({
        model,
        schema: EvaluationSchema,
        system: systemPrompt || defaultSystemPrompt,
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
      });

      return result.object;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        evaluation: "INVALID",
        reasoning: `Evaluation failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Evaluate with a custom system prompt for multi-screenshot analysis.
   */
  async evaluateWithMultipleScreenshots(options: {
    question: string;
    screenshots: Buffer[];
    agentReasoning?: string;
  }): Promise<EvaluationResult> {
    const { question, screenshots, agentReasoning } = options;

    const systemPrompt = `You are an expert evaluator that confidently returns YES or NO given a question and multiple screenshots showing the progression of a task.
${agentReasoning ? "You also have access to the agent's detailed reasoning and thought process throughout the task." : ""}

Analyze ALL screenshots to understand the complete journey. Look for evidence of task completion across all screenshots, not just the last one.
Success criteria may appear at different points in the sequence (confirmation messages, intermediate states, etc).
${agentReasoning ? "The agent's reasoning provides crucial context about what actions were attempted, what was observed, and the decision-making process. Use this alongside the visual evidence to make a comprehensive evaluation." : ""}

Today's date is ${new Date().toLocaleDateString()}.`;

    return this.evaluate({
      question,
      screenshots,
      agentReasoning,
      systemPrompt,
    });
  }
}
