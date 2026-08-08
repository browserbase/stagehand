#!/usr/bin/env node

import { createStagehandSandbox } from "./sandbox.js";

const SHUTDOWN_FALLBACK_MS = 35_000;

type LeaseEnd = { signal?: NodeJS.Signals };

try {
  const packageArtifactsPath = requiredEnvironment("STAGEHAND_SANDBOX_ARTIFACTS");
  const browserbaseApiKey = requiredEnvironment("BROWSERBASE_API_KEY");
  const browserbaseProjectId = requiredEnvironment("BROWSERBASE_PROJECT_ID");
  const vercelCredentials = vercelCredentialsFromEnvironment();
  const setupAbort = new AbortController();
  const leaseEnd = waitForLeaseEnd(setupAbort);
  const connection = await createStagehandSandbox({
    packageArtifactsPath,
    browserbaseApiKey,
    browserbaseProjectId,
    vercelCredentials,
    signal: setupAbort.signal,
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
  process.stdin.pause();
  process.stderr.write(`Stagehand sandbox lease failed: ${safeMessage(error)}\n`);
  process.exitCode = 1;
}

function waitForLeaseEnd(setupAbort: AbortController): Promise<LeaseEnd> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (end: LeaseEnd = {}) => {
      if (finished) return;
      finished = true;
      setupAbort.abort();
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

function vercelCredentialsFromEnvironment() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return undefined;
  return {
    teamId: requiredEnvironment("VERCEL_TEAM_ID"),
    projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
    token,
  };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
