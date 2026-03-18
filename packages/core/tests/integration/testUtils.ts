import type { V3 } from "../../lib/v3/v3.js";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import { AISdkClient } from "../../lib/v3/llm/aisdk.js";

/**
 * Races a promise against a timeout.
 * Resolves to the promise value or "timeout" if the deadline expires.
 */
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const CLOSE_TIMEOUT_MS = 5_000;

async function settleWithTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([promise.catch(() => {}), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function closeV3(v3?: V3 | null): Promise<void> {
  if (!v3) return;
  const isBrowserbase = v3.isBrowserbase;
  if (isBrowserbase) {
    try {
      await settleWithTimeout(
        v3.context.conn.send("Browser.close"),
        CLOSE_TIMEOUT_MS,
      );
    } catch {
      // best-effort cleanup
    }
  }

  await settleWithTimeout(v3.close(), CLOSE_TIMEOUT_MS);
}

type JsonResponseKey =
  | "act"
  | "Observation"
  | "Metadata"
  | "Extraction"
  | "default";

type JsonResponseValue =
  | Record<string, unknown>
  | ((options: LanguageModelV2CallOptions) => Record<string, unknown>);

type JsonResponseScript = JsonResponseValue | JsonResponseValue[];

type GenerateResponseValue =
  | {
      content: LanguageModelV2Content[];
      finishReason?: LanguageModelV2FinishReason;
      usage?: Partial<LanguageModelV2Usage>;
    }
  | ((options: LanguageModelV2CallOptions) => {
      content: LanguageModelV2Content[];
      finishReason?: LanguageModelV2FinishReason;
      usage?: Partial<LanguageModelV2Usage>;
    });

type ScriptedLanguageModel = LanguageModelV2 & {
  doGenerateCalls: LanguageModelV2CallOptions[];
};

type ScriptedGenerateResult = {
  content: LanguageModelV2Content[];
  finishReason?: LanguageModelV2FinishReason;
  usage?: Partial<LanguageModelV2Usage>;
};

const DEFAULT_USAGE: LanguageModelV2Usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

const mergeUsage = (
  usage?: Partial<LanguageModelV2Usage>,
): LanguageModelV2Usage => ({
  ...DEFAULT_USAGE,
  ...(usage ?? {}),
});

function consumeScriptValue<T>(value: T | T[] | undefined, fallback: T): T {
  if (!Array.isArray(value)) {
    return value ?? fallback;
  }

  if (value.length <= 1) {
    return value[0] ?? fallback;
  }

  return value.shift() ?? fallback;
}

function resolveJsonResponseKey(
  options: LanguageModelV2CallOptions,
): JsonResponseKey {
  const responseFormat = options.responseFormat;
  if (!responseFormat || responseFormat.type !== "json") {
    return "default";
  }

  const schema = responseFormat.schema as {
    type?: string;
    properties?: Record<string, unknown>;
  };
  const properties = schema?.properties ?? {};

  if ("elementId" in properties && "twoStep" in properties) {
    return "act";
  }

  if ("elements" in properties) {
    return "Observation";
  }

  if ("completed" in properties && "progress" in properties) {
    return "Metadata";
  }

  return "Extraction";
}

export function promptToText(
  prompt: LanguageModelV2CallOptions["prompt"],
): string {
  return (prompt ?? [])
    .flatMap((message) => {
      if (typeof message.content === "string") {
        return [message.content];
      }

      return (message.content ?? [])
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter((text): text is string => text.length > 0);
    })
    .join("\n");
}

function findEncodedIds(options: LanguageModelV2CallOptions): string[] {
  return [...promptToText(options.prompt).matchAll(/\b\d+-\d+\b/g)].map(
    (match) => match[0],
  );
}

export function findEncodedIdForText(
  options: LanguageModelV2CallOptions,
  text: string,
): string {
  const promptText = promptToText(options.prompt);
  const lines = promptText.split("\n");
  const line = lines.find((entry) => entry.includes(text));
  const match = line?.match(/\b\d+-\d+\b/);

  if (!match) {
    throw new Error(`Could not find encoded id for text: ${text}`);
  }

  return match[0];
}

export function findLastEncodedId(options: LanguageModelV2CallOptions): string {
  const matches = findEncodedIds(options);
  if (matches.length === 0) {
    throw new Error("Could not find any encoded ids in the prompt.");
  }

  return matches[matches.length - 1];
}

export function toolCallResponse(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = `${toolName}-1`,
): {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
} {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: "tool-calls",
    usage: DEFAULT_USAGE,
  };
}

export function doneToolResponse(
  reasoning = "done",
  taskComplete = true,
  toolCallId = "done-1",
): {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
} {
  return toolCallResponse("done", { reasoning, taskComplete }, toolCallId);
}

function createGenerateResult(result: ScriptedGenerateResult): {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
  warnings: [];
} {
  return {
    content: result.content,
    finishReason: result.finishReason ?? "stop",
    usage: mergeUsage(result.usage),
    warnings: [],
  };
}

export function createScriptedAisdkTestLlmClient(options?: {
  modelId?: string;
  jsonResponses?: Partial<Record<JsonResponseKey, JsonResponseScript>>;
  generateResponses?: GenerateResponseValue[];
}): AISdkClient {
  const jsonResponses = Object.fromEntries(
    Object.entries(options?.jsonResponses ?? {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  ) as Partial<Record<JsonResponseKey, JsonResponseScript>>;
  const generateResponses = [...(options?.generateResponses ?? [])];

  const model: ScriptedLanguageModel = {
    provider: "mock",
    modelId: options?.modelId ?? "mock/stagehand-flow-logger",
    specificationVersion: "v2",
    supportedUrls: {},
    doGenerateCalls: [],
    doGenerate: async (callOptions) => {
      model.doGenerateCalls.push(callOptions);

      if (callOptions.responseFormat?.type === "json") {
        const key = resolveJsonResponseKey(callOptions);
        const responseScripts = consumeScriptValue<
          JsonResponseScript | undefined
        >(jsonResponses[key], jsonResponses.default);
        const responseScript = consumeScriptValue<
          JsonResponseValue | undefined
        >(responseScripts, undefined);
        const response =
          typeof responseScript === "function"
            ? responseScript(callOptions)
            : (responseScript ?? {});

        return createGenerateResult({
          content: [{ type: "text", text: JSON.stringify(response) }],
        });
      }

      const responseScript = consumeScriptValue<
        GenerateResponseValue | undefined
      >(generateResponses, undefined);

      if (!responseScript) {
        return createGenerateResult({
          content: [{ type: "text", text: "done" }],
        });
      }

      const response =
        typeof responseScript === "function"
          ? responseScript(callOptions)
          : responseScript;

      return createGenerateResult(response);
    },
    doStream: async () => {
      throw new Error("Streaming is not implemented for this test model.");
    },
  };

  return new AISdkClient({ model });
}
