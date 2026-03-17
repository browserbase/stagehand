import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import { AISdkClient } from "../../lib/v3/llm/aisdk.js";

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

const DEFAULT_USAGE: LanguageModelV2Usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

function mergeUsage(
  usage?: Partial<LanguageModelV2Usage>,
): LanguageModelV2Usage {
  return {
    ...DEFAULT_USAGE,
    ...(usage ?? {}),
  };
}

function consumeScriptValue<T>(value: T | T[] | undefined, fallback: T): T {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return fallback;
    }

    if (value.length === 1) {
      return value[0];
    }

    return value.shift() ?? fallback;
  }

  return value ?? fallback;
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
  const promptText = promptToText(options.prompt);
  const matches = [...promptText.matchAll(/\b\d+-\d+\b/g)];

  if (matches.length === 0) {
    throw new Error("Could not find any encoded ids in the prompt.");
  }

  return matches[matches.length - 1][0];
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

        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
          finishReason: "stop" as const,
          usage: DEFAULT_USAGE,
          warnings: [],
        };
      }

      const responseScript = consumeScriptValue<
        GenerateResponseValue | undefined
      >(generateResponses, undefined);

      if (!responseScript) {
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop" as const,
          usage: DEFAULT_USAGE,
          warnings: [],
        };
      }

      const response =
        typeof responseScript === "function"
          ? responseScript(callOptions)
          : responseScript;

      return {
        content: response.content,
        finishReason: response.finishReason ?? "stop",
        usage: mergeUsage(response.usage),
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("Streaming is not implemented for this test model.");
    },
  };

  return new AISdkClient({ model });
}
