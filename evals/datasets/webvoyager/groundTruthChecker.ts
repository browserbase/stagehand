/**
 * WebVoyager Ground Truth Checker
 *
 * WARNING: The reference answers in reference-answers.json may be outdated
 * and should be used with caution. These are default values from the original
 * WebVoyager dataset and may not reflect current website content or behavior.
 *
 * To enable ground truth checking, set WEBVOYAGER_USE_GROUND_TRUTH=true
 * Default is false (disabled) to use VLM screenshot evaluation instead.
 */

import * as path from "path";
import * as fs from "fs";
import type { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v3";
import { generateObject } from "ai";
import { AISdkClient } from "../../../lib/llm/aisdk";
import type { LLMParsedResponse } from "../../../lib/inference";

interface ReferenceAnswer {
  id: number;
  type: "golden" | "possible";
  ans: string;
}

interface WebsiteAnswers {
  notice?: string;
  answers: ReferenceAnswer[];
}

interface ReferenceData {
  [website: string]: WebsiteAnswers;
}

interface GroundTruthResult {
  confident: boolean;
  match: boolean;
  reasoning: string;
  matchedAnswerType?: "golden" | "possible";
}

// Schema for the LLM response
const GroundTruthResponseSchema = z.object({
  decision: z.enum(["MATCH_GOLDEN", "MATCH_POSSIBLE", "NO_MATCH", "UNCERTAIN"]),
  reasoning: z.string().describe("Brief explanation of the decision"),
});

type GroundTruthResponse = z.infer<typeof GroundTruthResponseSchema>;

let referenceData: ReferenceData | null = null;

function loadReferenceAnswers(): ReferenceData {
  if (referenceData === null) {
    const referencePath = path.join(__dirname, "reference-answers.json");
    const rawData = fs.readFileSync(referencePath, "utf-8");
    referenceData = JSON.parse(rawData) as ReferenceData;
  }
  return referenceData;
}

function getReferenceAnswers(website: string, id: number): ReferenceAnswer[] {
  try {
    const data = loadReferenceAnswers();
    const websiteData = data[website];
    if (!websiteData || !websiteData.answers) {
      return [];
    }

    // Find the specific answer by id
    const answer = websiteData.answers.find((ans) => ans.id === id);
    return answer ? [answer] : [];
  } catch (error) {
    console.warn(
      `Failed to load reference answers for ${website}--${id}:`,
      error,
    );
    return [];
  }
}

export async function checkGroundTruthWithLLM(
  taskId: string,
  agentAnswer: string,
  stagehand: Stagehand,
): Promise<GroundTruthResult> {
  try {
    // Parse taskId: "Allrecipes--0" -> website="Allrecipes", id=0
    const parts = taskId.split("--");
    if (parts.length !== 2) {
      return {
        confident: false,
        match: false,
        reasoning: "Invalid task ID format",
      };
    }

    const [website, idStr] = parts;
    const referenceId = parseInt(idStr);

    if (isNaN(referenceId)) {
      return {
        confident: false,
        match: false,
        reasoning: "Invalid reference ID",
      };
    }

    // Load reference answers
    const referenceAnswers = getReferenceAnswers(website, referenceId);

    if (!referenceAnswers.length) {
      return {
        confident: false,
        match: false,
        reasoning: "No reference answers found",
      };
    }

    // Use LLM to compare agent answer with reference answers
    const prompt = `Compare the agent's answer with the reference answers and determine if they match.

Agent's Answer: "${agentAnswer}"

Reference Answers:
${referenceAnswers.map((ref) => `- ${ref.type.toUpperCase()}: "${ref.ans}"`).join("\n")}

Guidelines:
- GOLDEN answers are the most ideal/correct responses
- POSSIBLE answers are acceptable alternative responses
- Look for semantic equivalence, not exact word matching
- Consider if the agent's answer contains the key information from any reference answer
- Be reasonably flexible with formatting and phrasing differences

Decide which of the following best describes the match:
- MATCH_GOLDEN: The agent's answer matches a golden reference answer
- MATCH_POSSIBLE: The agent's answer matches a possible reference answer
- NO_MATCH: The agent's answer doesn't match any reference answer
- UNCERTAIN: Cannot confidently determine if there's a match`;

    let llmResponse: GroundTruthResponse;

    // Check if we can use generateObject directly (AI SDK client)
    if (stagehand.llmClient instanceof AISdkClient) {
      const model = stagehand.llmClient.getLanguageModel();
      const result = await generateObject({
        model,
        messages: [{ role: "user", content: prompt }],
        schema: GroundTruthResponseSchema,
      });
      llmResponse = result.object;
    } else {
      // Fallback to the existing createChatCompletion with response_model
      const result = await stagehand.llmClient.createChatCompletion<
        LLMParsedResponse<GroundTruthResponse>
      >({
        options: {
          messages: [{ role: "user", content: prompt }],
          response_model: {
            name: "GroundTruthResponse",
            schema: GroundTruthResponseSchema,
          },
        },
        logger: () => {}, // Silent logger for ground truth check
      });

      // Extract the structured data from the response
      llmResponse = result.data;
    }

    // Process the structured response
    switch (llmResponse.decision) {
      case "MATCH_GOLDEN":
        return {
          confident: true,
          match: true,
          reasoning: llmResponse.reasoning,
          matchedAnswerType: "golden",
        };
      case "MATCH_POSSIBLE":
        return {
          confident: true,
          match: true,
          reasoning: llmResponse.reasoning,
          matchedAnswerType: "possible",
        };
      case "NO_MATCH":
        return {
          confident: true,
          match: false,
          reasoning: llmResponse.reasoning,
        };
      case "UNCERTAIN":
      default:
        return {
          confident: false,
          match: false,
          reasoning: llmResponse.reasoning || "Could not determine match",
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error(`Ground truth check error for ${taskId}:`, {
      error: errorMessage,
      stack: errorStack,
      agentAnswer: agentAnswer?.substring(0, 100) + "...",
    });
    return {
      confident: false,
      match: false,
      reasoning: `Error in ground truth check: ${errorMessage}`,
    };
  }
}
