import { GoogleGenAI, Environment, type GenerateContentConfig } from "@google/genai";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";
import type { CuaFacadeTools, GeminiToolExecutor } from "./executor.js";
import { isTerminalFacadeError, type BrowserSessionLossReader } from "./errors.js";

export type GeminiCuaUsage = {
  input: number;
  output: number;
  reasoning: number;
  cached_input: number;
  total: number;
};
export type GeminiCuaSessionEvent =
  | { type: "assistant"; turn: number; text: string; parts: unknown[]; usage: GeminiCuaUsage }
  | { type: "tool_use"; turn: number; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      turn: number;
      id: string;
      name: string;
      text: string;
      error: boolean;
      response?: Record<string, unknown>;
      image?: { data: string; mimeType: string };
    };
export type GeminiGenerateClient = {
  generateContent(request: Record<string, unknown>): Promise<unknown>;
};
export type GeminiCuaSessionInput = {
  prompt: string;
  model: string;
  logger: HarnessLogger;
  maxTurns: number;
  tools: GeminiToolExecutor;
  facade: Pick<CuaFacadeTools, "screenshot" | "run">;
  systemPrompt?: string;
  signal?: AbortSignal;
  client?: GeminiGenerateClient;
  browserSessionLoss?: BrowserSessionLossReader;
};
export type GeminiCuaSessionResult = {
  events: GeminiCuaSessionEvent[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: GeminiCuaUsage;
  /** Whether any response supplied a finite nonnegative token counter (including real zero). */
  usageReported: boolean;
  turns: number;
  toolCalls: number;
  iterationError?: unknown;
};

export const GEMINI_CUA_DEFAULT_MODEL = "gemini-3.8-flash";
export const GEMINI_CUA_GENERATION_CONFIG = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
} as const;

export function normalizeGeminiCuaModel(model: string): string {
  // Strip the eval catalog alias only. Native model/resource names belong to
  // Google, which validates support; new identifiers require no client release.
  const bare = model.startsWith("google/") ? model.slice("google/".length) : model;
  if (!bare.trim())
    throw new HarnessAdapterError("Gemini Computer Use requires a non-empty model identifier.");
  return bare;
}

export function createGeminiClient(options?: { apiKey?: string }): GeminiGenerateClient {
  const client = new GoogleGenAI({ ...(options?.apiKey && { apiKey: options.apiKey }) });
  return {
    generateContent: (request) =>
      client.models.generateContent(request as never) as unknown as Promise<unknown>,
  };
}

export async function runGeminiCuaSession(
  input: GeminiCuaSessionInput,
): Promise<GeminiCuaSessionResult> {
  const contents: Array<Record<string, unknown>> = [
    { role: "user", parts: [{ text: input.prompt }] },
  ];
  const events: GeminiCuaSessionEvent[] = [];
  let usageReported = false;
  const usage: GeminiCuaUsage = { input: 0, output: 0, reasoning: 0, cached_input: 0, total: 0 };
  let finalMessage = "";
  let turns = 0;
  let toolCalls = 0;
  let status: GeminiCuaSessionResult["status"] = "max_turns";
  let stopReason: string | undefined;
  let iterationError: unknown;

  try {
    const model = normalizeGeminiCuaModel(input.model);
    throwIfAborted(input.signal);
    const client = input.client ?? createGeminiClient();
    await input.facade.run("await page.setViewportSize({ width: 1288, height: 711 });");
    while (turns < input.maxTurns) {
      throwIfAborted(input.signal);
      turns += 1;
      const response = await generateWithRetry(
        client,
        {
          model,
          contents,
          config: {
            ...(input.systemPrompt && { systemInstruction: input.systemPrompt }),
            ...(input.signal && { abortSignal: input.signal }),
            ...GEMINI_CUA_GENERATION_CONFIG,
            tools: [{ computerUse: { environment: Environment.ENVIRONMENT_BROWSER } }],
          } satisfies GenerateContentConfig,
        },
        input.signal,
      );
      const candidate = (
        response as {
          candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }>;
        }
      ).candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const rawUsage =
        (response as { usageMetadata?: Record<string, unknown> }).usageMetadata ?? {};
      usageReported ||= [
        "promptTokenCount",
        "candidatesTokenCount",
        "thoughtsTokenCount",
        "cachedContentTokenCount",
        "totalTokenCount",
      ].some(
        (key) =>
          typeof rawUsage[key] === "number" &&
          Number.isFinite(rawUsage[key]) &&
          Number(rawUsage[key]) >= 0,
      );
      const turnUsage = readUsage(rawUsage);
      usage.input += turnUsage.input;
      usage.output += turnUsage.output;
      usage.reasoning += turnUsage.reasoning;
      usage.cached_input += turnUsage.cached_input;
      usage.total += turnUsage.total;
      const text = parts
        .filter(isRecord)
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      events.push({ type: "assistant", turn: turns, text, parts, usage: turnUsage });
      if (!candidate) throw new HarnessAdapterError("Gemini returned no response candidate.");
      // A successful HTTP request can still be blocked or truncated. Retain
      // its evidence and usage, but do not execute partial calls or report it
      // as a completed task.
      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        throw new HarnessAdapterError(
          `Gemini response ended with ${sanitizeErrorMessage(candidate.finishReason)}.`,
        );
      }
      contents.push({ role: "model", parts });
      const calls = parts
        .filter(isRecord)
        .filter((part) => "functionCall" in part)
        .map((part) => validateFunctionCall(part.functionCall));
      if (calls.length === 0) {
        if (!text)
          throw new HarnessAdapterError("Gemini returned neither tool calls nor an answer.");
        finalMessage = text;
        status = "completed";
        stopReason = candidate?.finishReason;
        break;
      }
      const results: Record<string, unknown>[] = [];
      for (const call of calls) {
        throwIfAborted(input.signal);
        const { name, args } = call;
        const id = typeof call.id === "string" ? call.id : `call_${toolCalls}`;
        toolCalls += 1;
        events.push({ type: "tool_use", turn: turns, id, name, input: args });
        const result = await input.tools.execute(name, args, {
          signal: input.signal,
          toolUseId: id,
        });
        const resultEvent: Extract<GeminiCuaSessionEvent, { type: "tool_result" }> = {
          type: "tool_result",
          turn: turns,
          id,
          name,
          text: result.text,
          error: result.isError === true,
        };
        events.push(resultEvent);
        const observed = await observePage(input.facade, input.signal, input.browserSessionLoss);
        const response: Record<string, unknown> = result.isError
          ? { error: result.text }
          : { output: result.text };
        response.url = observed.url;
        if (observed.error) response.screenshot_error = observed.error;
        if (args.safety_decision !== undefined) response.safety_acknowledgement = "true";
        resultEvent.response = response;
        if (observed.shot) resultEvent.image = observed.shot;
        results.push({
          functionResponse: {
            id,
            name,
            response,
            ...(observed.shot && {
              parts: [
                { inlineData: { mimeType: observed.shot.mimeType, data: observed.shot.data } },
              ],
            }),
          },
        });
      }
      contents.push({ role: "user", parts: results });
    }
  } catch (error) {
    status = "sdk_error";
    stopReason = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    iterationError = new HarnessAdapterError(stopReason);
    input.logger.warn({
      category: "gemini_cua",
      message: `session ended with error: ${stopReason}`,
      level: 1,
    });
  }
  return {
    events,
    finalMessage,
    status,
    stopReason,
    tokenUsage: usage,
    usageReported,
    turns,
    toolCalls,
    ...(iterationError !== undefined && { iterationError }),
  };
}

async function generateWithRetry(
  client: GeminiGenerateClient,
  request: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      throwIfAborted(signal);
      return await client.generateContent(request);
    } catch (error) {
      if (signal?.aborted) throw error;
      last = error;
      if (!isTransientError(error) || attempt === 4) break;
      const delay = 100 * 2 ** attempt + Math.floor(Math.random() * 51);
      await pause(delay, signal);
    }
  }
  throw last;
}

function isTransientError(error: unknown): boolean {
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const status = Number(value.status ?? value.statusCode ?? value.code);
  return (
    status === 429 ||
    (status >= 500 && status <= 599) ||
    /network|timeout|fetch failed|econn/iu.test(String(value.message ?? error))
  );
}

function readUsage(meta: Record<string, unknown>): GeminiCuaUsage {
  const number = (key: string) =>
    typeof meta[key] === "number" && Number.isFinite(meta[key]) ? Number(meta[key]) : 0;
  const reasoning = number("thoughtsTokenCount");
  return {
    input: number("promptTokenCount"),
    output: number("candidatesTokenCount"),
    reasoning,
    cached_input: number("cachedContentTokenCount"),
    total:
      typeof meta.totalTokenCount === "number" &&
      Number.isFinite(meta.totalTokenCount) &&
      meta.totalTokenCount >= 0
        ? meta.totalTokenCount
        : number("promptTokenCount") + number("candidatesTokenCount") + reasoning,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HarnessAdapterError("session aborted");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Post-action observation for the model. A page mid-navigation can make the
 * facade's screenshot / url calls fail (e.g. waitForMainLoadState timeouts);
 * that is a transient page state, not a session failure, so retry once and
 * otherwise tell the model the screenshot is unavailable this turn.
 */
async function observePage(
  facade: Pick<CuaFacadeTools, "screenshot" | "run">,
  signal?: AbortSignal,
  browserSessionLoss?: BrowserSessionLossReader,
): Promise<{ shot?: { data: string; mimeType: string }; url: string; error?: string }> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      throwIfAborted(signal);
      const shot = await facade.screenshot({ type: "png" });
      const urlValue = await facade.run("return page.url();");
      return { shot, url: typeof urlValue === "string" ? urlValue : "" };
    } catch (error) {
      if (signal?.aborted || isTerminalFacadeError(error, browserSessionLoss)) throw error;
      lastError = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      if (attempt === 0) await pause(1500, signal);
    }
  }
  return { url: "", error: `screenshot unavailable this turn: ${lastError}` };
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const aborted = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(new HarnessAdapterError("session aborted"));
    };
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/** Validate the entire response before executing any member of its call batch. */
function validateFunctionCall(value: unknown): {
  name: string;
  args: Record<string, unknown>;
  id?: string;
} {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    (value.args !== undefined && !isRecord(value.args)) ||
    (value.id !== undefined && (typeof value.id !== "string" || !value.id.trim()))
  )
    throw new HarnessAdapterError("Gemini returned a malformed function call.");
  return {
    name: value.name,
    args: value.args ?? {},
    ...(value.id !== undefined && { id: value.id }),
  };
}
