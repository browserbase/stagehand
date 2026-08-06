import { groq } from "@ai-sdk/groq";
import { runStagehandAgent } from "./agent.js";

process.env.STAGEHAND_BROWSER ??= "local";

const result = await runStagehandAgent(
  groq(process.env.VERCEL_STAGEHAND_MODEL ?? "openai/gpt-oss-120b"),
  [
    "Use code_execute exactly twice.",
    "First navigate to https://example.com, open one additional blank tab, then restore the Example Domain page as active.",
    "Second return the active page title and total context page count.",
    "Report the title and count in your final answer.",
  ].join(" "),
);

if (
  result.toolNames.length !== 2 ||
  result.toolNames.some((name) => name !== "code_execute") ||
  !result.text.includes("Example Domain") ||
  !result.text.includes("2")
) {
  throw new Error(`Unexpected agent result: ${JSON.stringify(result)}`);
}

process.stdout.write(`${JSON.stringify({ status: "PASS", ...result })}\n`);
