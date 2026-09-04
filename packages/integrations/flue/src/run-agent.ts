import dotenv from "dotenv";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import { runFlueSession } from "@browserbasehq/stagehand-integrations-flue-sdk";
import { FLUE_STAGEHAND_INSTRUCTIONS, STAGEHAND_TOOLS } from "../agent/agent.js";
import { closeFacadeSession } from "./session.js";

dotenv.config();

const task = process.argv.slice(2).join(" ").trim();
if (!task) throw new Error('Usage: pnpm start "Open https://example.com and report the title."');

let primaryError: unknown;
try {
  const result = await runFlueSession({
    prompt: task,
    model: process.env.FLUE_STAGEHAND_MODEL ?? "openai/gpt-5.6-luna",
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    session: { tools: STAGEHAND_TOOLS, instructions: FLUE_STAGEHAND_INSTRUCTIONS },
  });
  if (result.status !== "completed") {
    throw new Error(result.stopReason ?? "Flue did not complete the task.");
  }
  process.stdout.write(`${result.finalMessage}\n`);
} catch (error) {
  primaryError = error;
}

const cleanupErrors: unknown[] = [];
await closeFacadeSession().catch((error: unknown) => cleanupErrors.push(error));

if (primaryError !== undefined && cleanupErrors.length > 0) {
  throw new AggregateError([primaryError, ...cleanupErrors], "Flue run and cleanup failed");
}
if (primaryError !== undefined) {
  throw new Error(
    sanitizeErrorMessage(
      primaryError instanceof Error ? primaryError.message : String(primaryError),
    ),
  );
}
if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Flue cleanup failed");
