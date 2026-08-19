import { randomUUID } from "node:crypto";

import { init } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import dotenv from "dotenv";

import { StagehandAgent } from "../agent/agent.js";
import { closeFacadeSession } from "./session.js";

dotenv.config();

const task = process.argv.slice(2).join(" ").trim();
if (!task) {
  throw new Error('Usage: pnpm start "Open https://example.com and report the title."');
}

const flue = await start({ agents: [StagehandAgent] });
const agent = init(StagehandAgent, { id: `stagehand-${randomUUID()}` });

const interrupt = () => {
  void agent.abort();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

let primaryError: unknown;
try {
  const receipt = await agent.dispatch(task);
  const reply = await agent.read(receipt);
  process.stdout.write(`${reply.text}\n`);
} catch (error) {
  primaryError = error;
}

process.removeListener("SIGINT", interrupt);
process.removeListener("SIGTERM", interrupt);

const cleanupErrors: unknown[] = [];
await agent.abort().catch((error: unknown) => cleanupErrors.push(error));
await closeFacadeSession().catch((error: unknown) => cleanupErrors.push(error));
await flue.stop().catch((error: unknown) => cleanupErrors.push(error));

if (primaryError !== undefined && cleanupErrors.length > 0) {
  throw new AggregateError([primaryError, ...cleanupErrors], "Flue run and cleanup failed");
}
if (primaryError !== undefined) throw primaryError;
if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Flue cleanup failed");
