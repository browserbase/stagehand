import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";

type V2Message = LanguageModelV2CallOptions["prompt"][number];
type V3Message = LanguageModelV3CallOptions["prompt"][number];

function mapFinishReason(
  finishReason: LanguageModelV2FinishReason,
): LanguageModelV3FinishReason {
  return {
    unified: finishReason === "unknown" ? "other" : finishReason,
    raw: finishReason,
  };
}

function mapUsage(usage: LanguageModelV2Usage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache:
        usage.inputTokens != null && usage.cachedInputTokens != null
          ? Math.max(usage.inputTokens - usage.cachedInputTokens, 0)
          : usage.inputTokens,
      cacheRead: usage.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: usage.outputTokens,
      reasoning: usage.reasoningTokens,
    },
  };
}

function mapWarnings(warnings: any[]) {
  return warnings.map((warning) => {
    if (warning.type === "unsupported-setting") {
      return {
        type: "unsupported" as const,
        feature: warning.setting ?? "setting",
        details: warning.details,
      };
    }

    if (warning.type === "unsupported-tool") {
      return {
        type: "unsupported" as const,
        feature: warning.tool?.name ?? "tool",
        details: warning.details,
      };
    }

    return {
      type: "other" as const,
      message: warning.message ?? "Provider warning",
    };
  });
}

function mapToolResultOutputV3ToV2(output: any): any {
  switch (output.type) {
    case "text":
    case "json":
    case "error-text":
    case "error-json":
      return output;
    case "execution-denied":
      return {
        type: "error-text",
        value: output.reason ?? "Execution denied",
      };
    case "content":
      return {
        type: "content",
        value: output.value.flatMap((part: any) => {
          switch (part.type) {
            case "text":
              return [{ type: "text" as const, text: part.text }];
            case "file-data":
            case "image-data":
              return [
                {
                  type: "media" as const,
                  data: part.data,
                  mediaType: part.mediaType,
                },
              ];
            case "file-url":
            case "image-url":
              return [
                {
                  type: "text" as const,
                  text: part.url,
                },
              ];
            case "file-id":
            case "image-file-id":
              return [
                {
                  type: "text" as const,
                  text: JSON.stringify({ fileId: part.fileId }),
                },
              ];
            default:
              return [];
          }
        }),
      };
  }
}

function mapToolResultOutputV2ToV3(output: any): any {
  if (output.type !== "content") {
    return output;
  }

  return {
    type: "content",
    value: output.value.map((part: any) =>
      part.type === "text"
        ? part
        : {
            type: "file-data" as const,
            data: part.data,
            mediaType: part.mediaType,
          },
    ),
  };
}

function mapPromptMessageV3ToV2(message: V3Message): V2Message {
  if (message.role === "system") {
    return {
      role: "system",
      content: message.content,
      providerOptions: message.providerOptions as LanguageModelV2CallOptions["providerOptions"],
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content
        .filter((part) => part.type === "tool-result")
        .map((part: any) => ({
          ...part,
          output: mapToolResultOutputV3ToV2(part.output),
          providerOptions:
            part.providerOptions as LanguageModelV2CallOptions["providerOptions"],
        })),
      providerOptions: message.providerOptions as LanguageModelV2CallOptions["providerOptions"],
    };
  }

  return {
    role: message.role,
    content: (message.content as any[]).flatMap((part: any) => {
      switch (part.type) {
        case "text":
        case "file":
        case "reasoning":
          return [
            {
              ...part,
              providerOptions:
                part.providerOptions as LanguageModelV2CallOptions["providerOptions"],
            },
          ];
        case "tool-call":
          return [
            {
              ...part,
              providerOptions:
                part.providerOptions as LanguageModelV2CallOptions["providerOptions"],
            },
          ];
        case "tool-result":
          return [
            {
              ...part,
              output: mapToolResultOutputV3ToV2(part.output),
              providerOptions:
                part.providerOptions as LanguageModelV2CallOptions["providerOptions"],
            },
          ];
        default:
          return [];
      }
    }),
    providerOptions: message.providerOptions as LanguageModelV2CallOptions["providerOptions"],
  } as V2Message;
}

function mapCallOptionsV3ToV2(
  options: LanguageModelV3CallOptions,
): LanguageModelV2CallOptions {
  return {
    ...options,
    prompt: options.prompt.map(mapPromptMessageV3ToV2),
    tools: options.tools?.map((tool) =>
      tool.type === "provider"
        ? {
            type: "provider-defined" as const,
            id: tool.id,
            name: tool.name,
            args: tool.args,
          }
        : {
            ...tool,
            providerOptions:
              tool.providerOptions as LanguageModelV2CallOptions["providerOptions"],
          },
    ),
    providerOptions:
      options.providerOptions as LanguageModelV2CallOptions["providerOptions"],
  };
}

function mapGeneratedContent(content: LanguageModelV2Content): LanguageModelV3Content {
  const providerMetadata =
    "providerMetadata" in content ? content.providerMetadata : undefined;

  switch (content.type) {
    case "tool-result":
      return {
        ...content,
        result: (content.result ?? {}) as never,
        providerMetadata: content.providerMetadata as never,
      };
    case "tool-call":
    case "text":
    case "reasoning":
    case "file":
    case "source":
      return {
        ...content,
        providerMetadata: providerMetadata as never,
      } as LanguageModelV3Content;
  }
}

function mapStreamPart(part: LanguageModelV2StreamPart): LanguageModelV3StreamPart {
  switch (part.type) {
    case "stream-start":
      return {
        type: "stream-start",
        warnings: mapWarnings(part.warnings),
      };
    case "finish":
      return {
        type: "finish",
        usage: mapUsage(part.usage),
        finishReason: mapFinishReason(part.finishReason),
        providerMetadata: part.providerMetadata as never,
      };
    case "tool-call":
      return {
        ...part,
        providerMetadata: part.providerMetadata as never,
      };
    case "tool-result":
      return {
        ...part,
        result: (part.result ?? {}) as never,
        providerMetadata: part.providerMetadata as never,
      };
    case "file":
    case "source":
    case "text-start":
    case "text-delta":
    case "text-end":
    case "reasoning-start":
    case "reasoning-delta":
    case "reasoning-end":
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
      return {
        ...part,
        providerMetadata: "providerMetadata" in part ? (part.providerMetadata as never) : undefined,
      } as LanguageModelV3StreamPart;
    case "response-metadata":
    case "raw":
    case "error":
      return part;
  }
}

export function wrapLanguageModelV2(model: LanguageModelV2): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    doGenerate: async (options) => {
      const result = await model.doGenerate(mapCallOptionsV3ToV2(options));
      return {
        content: result.content.map(mapGeneratedContent),
        finishReason: mapFinishReason(result.finishReason),
        usage: mapUsage(result.usage),
        providerMetadata: result.providerMetadata as never,
        request: result.request,
        response: result.response as never,
        warnings: mapWarnings(result.warnings),
      };
    },
    doStream: async (options) => {
      const result = await model.doStream(mapCallOptionsV3ToV2(options));
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(
              part: LanguageModelV2StreamPart,
              controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
            ) {
              controller.enqueue(mapStreamPart(part));
            },
          }),
        ),
      };
    },
  };
}
