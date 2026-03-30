import { randomUUID } from "node:crypto";

import type {
  BrowserSession,
  BrowserSessionCreateRequest,
  BrowserSessionUpdateRequest,
} from "../../schemas/v4/browserSession.js";
import { BrowserSessionSchema } from "../../schemas/v4/browserSession.js";

const browserSessions = new Map<string, BrowserSession>();

function buildId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function notFoundError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function findBrowserSessionOrThrow(id: string): BrowserSession {
  const browserSession = browserSessions.get(id);
  if (!browserSession) {
    throw notFoundError("Browser session not found");
  }
  return browserSession;
}

function buildBrowserSessionFromCreate(
  input: BrowserSessionCreateRequest,
  llmId: string,
): BrowserSession {
  const cdpUrl =
    input.env === "LOCAL"
      ? (input.cdpUrl ?? "ws://stub.invalid/devtools/browser/stub")
      : "ws://stub.invalid/devtools/browser/stub";

  return BrowserSessionSchema.parse({
    id: buildId("session"),
    llmId,
    actLlmId: input.actLlmId ?? null,
    observeLlmId: input.observeLlmId ?? null,
    extractLlmId: input.extractLlmId ?? null,
    env: input.env,
    status: "running",
    cdpUrl,
    available: true,
    browserbaseSessionId:
      input.env === "BROWSERBASE" ? input.browserbaseSessionId : undefined,
    browserbaseSessionCreateParams:
      input.env === "BROWSERBASE"
        ? input.browserbaseSessionCreateParams
        : undefined,
    localBrowserLaunchOptions:
      input.env === "LOCAL" ? input.localBrowserLaunchOptions : undefined,
    domSettleTimeoutMs: input.domSettleTimeoutMs,
    verbose: input.verbose,
    selfHeal: input.selfHeal,
    waitForCaptchaSolves: input.waitForCaptchaSolves,
    experimental: input.experimental,
    actTimeoutMs: input.actTimeoutMs,
  });
}

export function createBrowserSession(
  input: BrowserSessionCreateRequest,
  llmId: string,
): BrowserSession {
  const browserSession = buildBrowserSessionFromCreate(input, llmId);

  browserSessions.set(browserSession.id, browserSession);

  return browserSession;
}

export function getBrowserSession(id: string): BrowserSession {
  return findBrowserSessionOrThrow(id);
}

export function updateBrowserSession(
  id: string,
  input: BrowserSessionUpdateRequest,
): BrowserSession {
  const existing = findBrowserSessionOrThrow(id);

  const updated = BrowserSessionSchema.parse({
    ...existing,
    ...(input.llmId !== undefined ? { llmId: input.llmId } : {}),
    ...(input.actLlmId !== undefined ? { actLlmId: input.actLlmId } : {}),
    ...(input.observeLlmId !== undefined
      ? { observeLlmId: input.observeLlmId }
      : {}),
    ...(input.extractLlmId !== undefined
      ? { extractLlmId: input.extractLlmId }
      : {}),
    ...(input.domSettleTimeoutMs !== undefined
      ? { domSettleTimeoutMs: input.domSettleTimeoutMs }
      : {}),
    ...(input.verbose !== undefined ? { verbose: input.verbose } : {}),
    ...(input.selfHeal !== undefined ? { selfHeal: input.selfHeal } : {}),
    ...(input.waitForCaptchaSolves !== undefined
      ? { waitForCaptchaSolves: input.waitForCaptchaSolves }
      : {}),
    ...(input.experimental !== undefined
      ? { experimental: input.experimental }
      : {}),
    ...(input.actTimeoutMs !== undefined
      ? { actTimeoutMs: input.actTimeoutMs }
      : {}),
  });

  browserSessions.set(id, updated);

  return updated;
}

export function endBrowserSession(id: string): BrowserSession {
  const existing = findBrowserSessionOrThrow(id);
  const ended = BrowserSessionSchema.parse({
    ...existing,
    status: "ended",
    available: false,
  });

  browserSessions.delete(id);

  return ended;
}
