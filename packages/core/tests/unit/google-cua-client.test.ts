import { describe, expect, it, vi } from "vitest";
import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";
import type { Content } from "@google/genai";

function createClient() {
  return new GoogleCUAClient(
    "google",
    "google/gemini-2.5-computer-use-preview-10-2025",
    "test instructions",
    { apiKey: "test" },
  );
}

describe("GoogleCUAClient", () => {
  it("returns a fresh screenshot after executing a custom tool", async () => {
    const client = createClient();
    const screenshotProvider = vi.fn(async () => "fresh-screenshot-base64");
    client.setScreenshotProvider(screenshotProvider);
    client.setCurrentUrl("http://127.0.0.1:6789/");

    const toolExecute = vi.fn(async () => ({ filled: true }));
    (
      client as unknown as {
        tools: Record<
          string,
          {
            execute: typeof toolExecute;
          }
        >;
      }
    ).tools = {
      fillUsername: {
        execute: toolExecute,
      },
    };

    const generateContent = vi.fn(async () => ({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "fillUsername",
                  args: {},
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      },
    }));

    (
      client as unknown as {
        client: {
          models: {
            generateContent: typeof generateContent;
          };
        };
      }
    ).client = {
      models: {
        generateContent,
      },
    };

    await client.executeStep(vi.fn());

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(screenshotProvider).toHaveBeenCalledTimes(1);

    const history = (client as unknown as { history: Content[] }).history;
    const userResponse = history[history.length - 1];
    const functionResponse = userResponse.parts?.[0]?.functionResponse;

    expect(functionResponse).toMatchObject({
      name: "fillUsername",
      response: {
        result: JSON.stringify({ filled: true }),
        url: "http://127.0.0.1:6789/",
      },
      parts: [
        {
          inlineData: {
            mimeType: "image/png",
            data: "fresh-screenshot-base64",
          },
        },
      ],
    });
  });

  it("returns a success result and fresh screenshot when a custom tool completes with undefined", async () => {
    const client = createClient();
    const screenshotProvider = vi.fn(async () => "fresh-screenshot-base64");
    client.setScreenshotProvider(screenshotProvider);
    client.setCurrentUrl("http://127.0.0.1:6789/");

    const toolExecute = vi.fn(async () => undefined);
    (
      client as unknown as {
        tools: Record<
          string,
          {
            execute: typeof toolExecute;
          }
        >;
      }
    ).tools = {
      fillUsername: {
        execute: toolExecute,
      },
    };

    const generateContent = vi.fn(async () => ({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "fillUsername",
                  args: {},
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      },
    }));

    (
      client as unknown as {
        client: {
          models: {
            generateContent: typeof generateContent;
          };
        };
      }
    ).client = {
      models: {
        generateContent,
      },
    };

    await client.executeStep(vi.fn());

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(screenshotProvider).toHaveBeenCalledTimes(1);

    const history = (client as unknown as { history: Content[] }).history;
    const userResponse = history[history.length - 1];
    const functionResponse = userResponse.parts?.[0]?.functionResponse;

    expect(functionResponse).toMatchObject({
      name: "fillUsername",
      response: {
        result: "Tool executed successfully",
        url: "http://127.0.0.1:6789/",
      },
      parts: [
        {
          inlineData: {
            mimeType: "image/png",
            data: "fresh-screenshot-base64",
          },
        },
      ],
    });
  });

  it("reuses one fresh screenshot for custom and computer-use responses in the same step", async () => {
    const client = createClient();
    const screenshotProvider = vi.fn(async () => "shared-screenshot-base64");
    const actionHandler = vi.fn(async () => {});
    client.setScreenshotProvider(screenshotProvider);
    client.setActionHandler(actionHandler);
    client.setCurrentUrl("http://127.0.0.1:6789/");

    const toolExecute = vi.fn(async () => ({ filled: true }));
    (
      client as unknown as {
        tools: Record<
          string,
          {
            execute: typeof toolExecute;
          }
        >;
      }
    ).tools = {
      fillUsername: {
        execute: toolExecute,
      },
    };

    const generateContent = vi.fn(async () => ({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "fillUsername",
                  args: {},
                },
              },
              {
                functionCall: {
                  name: "click_at",
                  args: { x: 500, y: 500, button: "left" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
      },
    }));

    (
      client as unknown as {
        client: {
          models: {
            generateContent: typeof generateContent;
          };
        };
      }
    ).client = {
      models: {
        generateContent,
      },
    };

    await client.executeStep(vi.fn());

    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(actionHandler).toHaveBeenCalledTimes(1);
    expect(screenshotProvider).toHaveBeenCalledTimes(1);

    const history = (client as unknown as { history: Content[] }).history;
    const userResponse = history[history.length - 1];
    const functionResponses = userResponse.parts?.map(
      (part) => part.functionResponse,
    );

    expect(functionResponses).toHaveLength(2);
    expect(functionResponses?.map((response) => response?.name)).toEqual([
      "fillUsername",
      "click_at",
    ]);
    expect(
      functionResponses?.map(
        (response) => response?.parts?.[0]?.inlineData?.data,
      ),
    ).toEqual(["shared-screenshot-base64", "shared-screenshot-base64"]);
  });
});
