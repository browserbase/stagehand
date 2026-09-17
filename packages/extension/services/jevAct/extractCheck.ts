import { ask, round, type AskContext } from "./pick.js";
import { noulAnswer } from "./typesafeClient.js";

const MAX_EXTRACTED_CHARS = 6000;

/**
 * extract() follows its extraction call with a second, sequential LLM call
 * whose only output in use is a `completed` boolean. That is a yes/no over the
 * instruction and the extracted JSON: one Jev request instead of an LLM round trip.
 */
export async function extractionCompleted(
  ctx: AskContext,
  extracted: unknown,
): Promise<{ completed: boolean; score: number }> {
  const serialized = JSON.stringify(extracted) ?? "null";
  const response = await ask(
    ctx,
    "extract_completed",
    {
      instruction: ctx.instruction,
      extracted_content:
        serialized.length > MAX_EXTRACTED_CHARS
          ? `${serialized.slice(0, MAX_EXTRACTED_CHARS)}… (${serialized.length} chars)`
          : (JSON.parse(serialized) as never),
    },
    {
      completed: {
        type: "noul",
        instructions:
          "Does the extracted content accomplish the instruction's goal? Answer conservatively: yes only when the goal is clearly met.",
      },
    },
  );
  const score = round(noulAnswer(response, "completed").noul);
  return { completed: score >= 0.5, score };
}
