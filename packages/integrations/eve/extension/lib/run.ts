import type { ExperimentalBatchCallback } from "@browserbasehq/stagehand";

import { stagehandSession, type StagehandSession } from "./session.js";

interface RunEnvelope {
  value?: unknown;
  closeRequested: boolean;
  executionError?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => ExperimentalBatchCallback<Record<string, never>, RunEnvelope>;

export function compileRunCallback(
  code: string,
): ExperimentalBatchCallback<Record<string, never>, RunEnvelope> {
  if (code.trim().length === 0) throw new TypeError("run code must not be empty");

  return new AsyncFunction(
    "batch",
    "input",
    `"use strict";
const { page, context, act, observe, extract } = batch;
let closeRequested = false;
const close = async () => { closeRequested = true; };
let value;
let executionError;
try {
  value = await (async () => {
${code}
  })();
} catch (error) {
  executionError = {
    name: typeof error?.name === "string" ? error.name : "Error",
    message: typeof error?.message === "string" ? error.message : String(error),
  };
  if (typeof error?.stack === "string") executionError.stack = error.stack;
}
return { value, closeRequested, executionError };`,
  );
}

export async function runStagehandCode(
  code: string,
  session: StagehandSession = stagehandSession,
): Promise<string> {
  const callback = compileRunCallback(code);
  const value = await session.run(async (resources) => {
    const envelope = await resources.stagehand.experimentalBatch(callback, {}, { timeout: 60_000 });
    let cleanupError: unknown;
    if (envelope.closeRequested) {
      try {
        await session.close(resources);
      } catch (error) {
        cleanupError = error;
      }
    }

    if (envelope.executionError) {
      const error = new Error(envelope.executionError.message);
      error.name = envelope.executionError.name;
      if (envelope.executionError.stack) error.stack = envelope.executionError.stack;
      if (cleanupError) {
        throw new AggregateError([error, cleanupError], "Run failed and cleanup also failed.", {
          cause: error,
        });
      }
      throw error;
    }
    if (cleanupError) throw cleanupError;
    return envelope.value;
  });
  return stringifyResult(value);
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
