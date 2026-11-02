import {
  type HarnessLogger,
  sanitizeErrorMessage,
} from "@browserbasehq/stagehand-integrations/harness";
import { runMastraSession } from "@browserbasehq/stagehand-integrations-mastra";

import { facadeAgentSession } from "./facade.ts";

// oxlint-disable-next-line no-console -- CLI example surfaces adapter warnings and errors on stderr.
const stderr = (line: { message: string }) => console.error(line.message);
const logger: HarnessLogger = { log: () => {}, warn: stderr, error: stderr };

async function main() {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) {
    throw new Error('Usage: pnpm start "your instruction"');
  }

  // Bare model ids are routed to OpenAI; `provider/model` ids pick another provider.
  const result = await runMastraSession({
    prompt: instruction,
    model: process.env.MASTRA_STAGEHAND_MODEL ?? "gpt-5.6-luna",
    logger,
    session: facadeAgentSession(),
  });

  // Running out of steps still returns the agent's text, as agent.generate() does.
  // finalText arrives with secrets redacted by the adapter.
  if (result.status === "completed" || result.status === "max_turns") {
    if (result.status === "max_turns" && result.stopReason) stderr({ message: result.stopReason });
    // oxlint-disable-next-line no-console -- CLI example prints the agent result.
    console.log(result.finalText);
    return;
  }
  const detail =
    result.stopReason ??
    (result.iterationError instanceof Error
      ? sanitizeErrorMessage(result.iterationError.message)
      : undefined);
  throw new Error(`Mastra session ended with ${result.status}: ${detail ?? "unknown"}`);
}

main().catch((error: unknown) => {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
