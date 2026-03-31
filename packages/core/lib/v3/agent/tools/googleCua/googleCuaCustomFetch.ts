import type {
  Content,
  Part,
  FunctionResponse,
  FunctionResponsePart,
} from "@google/genai";

export function isGoogleCuaModel(modelName: string): boolean {
  return modelName.includes("computer-use");
}

/**
 * Internal-only fetch wrapper for Google CUA models.
 * Intercepts HTTP requests to swap functionDeclarations for computerUse config
 * and reformat tool responses to include screenshots in Google CUA format.
 *
 * NOT user-configurable -- only applied automatically inside getAISDKLanguageModel
 * when the model is detected as a Google CUA model.
 */
export function createGoogleCuaFetch(
  environment:
    | "ENVIRONMENT_BROWSER"
    | "ENVIRONMENT_DESKTOP" = "ENVIRONMENT_BROWSER",
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as {
          contents?: Content[];
          tools?: unknown[];
          toolConfig?: unknown;
        };

        body.tools = [{ computerUse: { environment } }];
        delete body.toolConfig;

        if (body.contents) {
          for (const content of body.contents) {
            if (!content.parts) continue;

            const newParts: Part[] = [];
            let pendingFnResponse: Part | null = null;

            for (const part of content.parts) {
              if (part.functionResponse) {
                if (pendingFnResponse) {
                  newParts.push(pendingFnResponse);
                }

                let url = "";
                const resp = part.functionResponse.response;
                const respContent = resp?.content as string | undefined;
                if (respContent) {
                  try {
                    const parsed = JSON.parse(respContent) as {
                      url?: string;
                    };
                    url = parsed.url || "";
                  } catch {
                    // not JSON content
                  }
                }

                const fnResponse: FunctionResponse = {
                  name: part.functionResponse.name,
                  response: { url },
                };
                pendingFnResponse = { functionResponse: fnResponse };
              } else if (part.inlineData && pendingFnResponse) {
                const screenshotPart: FunctionResponsePart = {
                  inlineData: {
                    mimeType: part.inlineData.mimeType || "image/png",
                    data: part.inlineData.data,
                  },
                };
                pendingFnResponse.functionResponse!.parts = [screenshotPart];
                newParts.push(pendingFnResponse);
                pendingFnResponse = null;
              } else if (
                part.text &&
                part.text.includes("Tool executed successfully")
              ) {
                continue;
              } else {
                newParts.push(part);
              }
            }

            if (pendingFnResponse) {
              newParts.push(pendingFnResponse);
            }

            content.parts = newParts;
          }
        }

        init = {
          ...init,
          body: JSON.stringify(body),
        };
      } catch {
        // JSON parsing failed, pass through unchanged
      }
    }

    return fetch(input, init);
  };
}
