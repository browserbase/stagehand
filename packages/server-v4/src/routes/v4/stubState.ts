import { randomUUID } from "node:crypto";

import type {
  BrowserSession,
  BrowserSessionCreateRequest,
  BrowserSessionUpdateRequest,
} from "../../schemas/v4/browserSession.js";
import { BrowserSessionSchema } from "../../schemas/v4/browserSession.js";
import type {
  LLM,
  LLMCreateRequest,
  LLMUpdateRequest,
} from "../../schemas/v4/llm.js";
import { LLMSchema } from "../../schemas/v4/llm.js";

const llms = new Map<string, LLM>();
const browserSessions = new Map<string, BrowserSession>();

const DEFAULT_LLM_MODEL_NAME = "openai/gpt-4.1-nano";

function buildId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notFoundError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function findLLMOrThrow(id: string): LLM {
  const llm = llms.get(id);
  if (!llm) {
    throw notFoundError("LLM not found");
  }
  return llm;
}

function findBrowserSessionOrThrow(id: string): BrowserSession {
  const browserSession = browserSessions.get(id);
  if (!browserSession) {
    throw notFoundError("Browser session not found");
  }
  return browserSession;
}

export function listLLMs(): LLM[] {
  return [...llms.values()];
}

export function getLLM(id: string): LLM {
  return findLLMOrThrow(id);
}

export function createLLM(input: LLMCreateRequest): LLM {
  const llm = buildLLM({
    source: "user",
    displayName: input.displayName,
    modelName: input.modelName,
    baseUrl: input.baseUrl,
    systemPrompt: input.systemPrompt,
    providerOptions: input.providerOptions,
  });

  llms.set(llm.id, llm);

  return llm;
}

function buildLLM(input: {
  source: LLM["source"];
  displayName?: string;
  modelName: string;
  baseUrl?: string;
  systemPrompt?: string;
  providerOptions?: LLM["providerOptions"];
}): LLM {
  const timestamp = nowIso();
  return LLMSchema.parse({
    id: buildId("llm"),
    source: input.source,
    displayName: input.displayName,
    modelName: input.modelName,
    baseUrl: input.baseUrl,
    systemPrompt: input.systemPrompt,
    providerOptions: input.providerOptions,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createDefaultLLM(): LLM {
  const llm = buildDefaultLLM();

  llms.set(llm.id, llm);

  return llm;
}

function buildDefaultLLM(): LLM {
  return buildLLM({
    source: "system-default",
    displayName: "Default LLM",
    modelName: DEFAULT_LLM_MODEL_NAME,
  });
}

export function updateLLM(id: string, input: LLMUpdateRequest): LLM {
  const existing = findLLMOrThrow(id);
  const updated = LLMSchema.parse({
    ...existing,
    ...(input.displayName !== undefined
      ? { displayName: input.displayName }
      : {}),
    ...(input.modelName !== undefined ? { modelName: input.modelName } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.systemPrompt !== undefined
      ? { systemPrompt: input.systemPrompt }
      : {}),
    ...(input.providerOptions !== undefined
      ? { providerOptions: input.providerOptions }
      : {}),
    updatedAt: nowIso(),
  });

  llms.set(id, updated);

  return updated;
}

function resolveOptionalLLMId(id: string | null | undefined): string | null {
  if (id === undefined || id === null) {
    return id ?? null;
  }

  return findLLMOrThrow(id).id;
}

function buildBrowserSessionFromCreate(
  input: BrowserSessionCreateRequest,
  llm: LLM,
): BrowserSession {
  const cdpUrl =
    input.env === "LOCAL"
      ? (input.cdpUrl ?? "ws://stub.invalid/devtools/browser/stub")
      : "ws://stub.invalid/devtools/browser/stub";

  return BrowserSessionSchema.parse({
    id: buildId("session"),
    llmId: llm.id,
    actLlmId: resolveOptionalLLMId(input.actLlmId),
    observeLlmId: resolveOptionalLLMId(input.observeLlmId),
    extractLlmId: resolveOptionalLLMId(input.extractLlmId),
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
): BrowserSession {
  const persistedLLM = input.llmId ? findLLMOrThrow(input.llmId) : null;
  const defaultLLM = persistedLLM ? null : buildDefaultLLM();
  const llm = persistedLLM ?? defaultLLM;
  const browserSession = buildBrowserSessionFromCreate(input, llm);

  if (defaultLLM) {
    llms.set(defaultLLM.id, defaultLLM);
  }

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
  const llm =
    input.llmId !== undefined
      ? findLLMOrThrow(input.llmId)
      : getLLM(existing.llmId);

  const updated = BrowserSessionSchema.parse({
    ...existing,
    llmId: llm.id,
    ...(input.actLlmId !== undefined
      ? { actLlmId: resolveOptionalLLMId(input.actLlmId) }
      : {}),
    ...(input.observeLlmId !== undefined
      ? { observeLlmId: resolveOptionalLLMId(input.observeLlmId) }
      : {}),
    ...(input.extractLlmId !== undefined
      ? { extractLlmId: resolveOptionalLLMId(input.extractLlmId) }
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
