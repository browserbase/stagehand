import {
  type HarnessLogger,
  sanitizeErrorMessage,
} from "@browserbasehq/stagehand-integrations/harness";
import {
  runMastraSession,
  type MastraSessionResult,
} from "@browserbasehq/stagehand-integrations-mastra";

import { facadeAgentSession } from "./facade.ts";

// oxlint-disable-next-line no-console -- CLI example surfaces adapter warnings and errors on stderr.
const stderr = (line: { message: string }) => console.error(line.message);
const logger: HarnessLogger = { log: () => {}, warn: stderr, error: stderr };

export function reportMastraResult(
  result: Pick<MastraSessionResult, "status" | "stopReason" | "finalText" | "iterationError">,
): string {
  if (result.status === "completed") return result.finalText;
  const reason =
    result.stopReason ??
    (result.iterationError instanceof Error
      ? sanitizeErrorMessage(result.iterationError.message)
      : "unknown");
  const lastText = result.finalText.trim();
  throw new Error(
    `Agent did not finish (${result.status}): ${reason}` +
      (lastText ? `\nLast agent message: ${lastText}` : ""),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');

  const result = await runMastraSession({
    prompt: instruction,
    model: process.env.MASTRA_STAGEHAND_MODEL ?? "gpt-5.6-luna",
    logger,
    session: facadeAgentSession(),
  });
  // oxlint-disable-next-line no-console -- CLI example prints the agent result.
  console.log(reportMastraResult(result));
}

if (import.meta.main) {
  main().catch(handleFailure);
}

function handleFailure(error: unknown): void {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
