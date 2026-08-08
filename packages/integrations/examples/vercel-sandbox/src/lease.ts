#!/usr/bin/env node

import { createStagehandSandbox } from "./sandbox.ts";

const SHUTDOWN_FALLBACK_MS = 35_000;

type LeaseEnd = { signal?: NodeJS.Signals };

try {
  const leaseEnd = waitForLeaseEnd();
  const connection = await createStagehandSandbox({
    stagehandRevision: requiredEnvironment("STAGEHAND_REVISION"),
    browserbaseApiKey: requiredEnvironment("BROWSERBASE_API_KEY"),
    browserbaseProjectId: requiredEnvironment("BROWSERBASE_PROJECT_ID"),
  });

  process.stdout.write(
    `${JSON.stringify({ url: connection.url.toString(), token: connection.token })}\n`,
  );

  const { signal } = await leaseEnd;
  const fallback = signal
    ? setTimeout(() => forwardSignal(signal), SHUTDOWN_FALLBACK_MS)
    : undefined;
  try {
    await connection.close();
  } catch (error) {
    process.stderr.write(`Stagehand sandbox lease cleanup failed: ${safeMessage(error)}\n`);
    if (!signal) process.exitCode = 1;
  } finally {
    clearTimeout(fallback);
  }

  if (signal) forwardSignal(signal);
} catch (error) {
  process.stderr.write(`Stagehand sandbox lease failed: ${safeMessage(error)}\n`);
  process.exitCode = 1;
}

function waitForLeaseEnd(): Promise<LeaseEnd> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (end: LeaseEnd = {}) => {
      if (finished) return;
      finished = true;
      resolve(end);
    };

    process.once("SIGINT", () => finish({ signal: "SIGINT" }));
    process.once("SIGTERM", () => finish({ signal: "SIGTERM" }));
    process.stdin.once("end", () => finish());
    process.stdin.once("close", () => finish());
    process.stdin.resume();
  });
}

function forwardSignal(signal: NodeJS.Signals): never {
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
  throw new Error(`Could not forward ${signal}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
