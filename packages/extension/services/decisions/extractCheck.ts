import { ask, round, type AskContext } from "./pick.js";
import { noulAnswer } from "./client.js";

const MAX_EXTRACTED_CHARS = 6000;

export async function extractionCompleted(
  ctx: AskContext,
  extracted: unknown,
): Promise<{ completed: boolean; score: number }> {
  const serialized = JSON.stringify(extracted) ?? "null";
  if (serialized.length > MAX_EXTRACTED_CHARS) {
    throw new Error(`extraction too large for the completion judge (${serialized.length} chars)`);
  }
  const response = await ask(
    ctx,
    "extract_completed",
    {
      instruction: ctx.instruction,
      extracted_content: JSON.parse(serialized) as never,
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
