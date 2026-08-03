import { describe, expect, it, vi, type Mock } from "vitest";
import OpenAI from "openai";
import { z } from "zod";
import { CustomOpenAIClient } from "../../lib/v3/external_clients/customOpenAI.js";
import type { LogLine } from "../../lib/v3/types/public/logs.js";

function noopLogger(_line: LogLine): void {}

function makeMockClient(response: unknown): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(response),
      },
    },
  } as unknown as OpenAI;
}

const FAKE_RESPONSE = {
  choices: [{ message: { role: "assistant", content: "test" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("CustomOpenAIClient vision support", () => {
  it("appends an image_url message when image is provided", async () => {
    const mock = makeMockClient(FAKE_RESPONSE);
    const createMock = mock.chat.completions.create as Mock;
    const client = new CustomOpenAIClient({
      modelName: "test-model",
      client: mock,
    });

    const imageBuffer = Buffer.from("fake-png-data");

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "describe this page" }],
        image: { buffer: imageBuffer, description: "current page screenshot" },
        requestId: "test-1",
      },
      logger: noopLogger,
      retries: 0,
    });

    const body = createMock.mock.calls[0][0];
    const messages = body.messages;

    const imageMessage = messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((c: { type: string }) => c.type === "image_url"),
    );

    expect(imageMessage).toBeDefined();

    const parts = imageMessage.content;
    expect(parts[0]).toMatchObject({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
      },
    });
    expect(parts[1]).toMatchObject({
      type: "text",
      text: "current page screenshot",
    });
  });

  it("omits the description part when not provided", async () => {
    const mock = makeMockClient(FAKE_RESPONSE);
    const createMock = mock.chat.completions.create as Mock;
    const client = new CustomOpenAIClient({
      modelName: "test-model",
      client: mock,
    });

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "describe" }],
        image: { buffer: Buffer.from("img") },
        requestId: "test-2",
      },
      logger: noopLogger,
      retries: 0,
    });

    const body = createMock.mock.calls[0][0];
    const messages = body.messages;

    const imageMessage = messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "user" && Array.isArray(m.content),
    );

    expect(imageMessage.content).toHaveLength(1);
    expect(imageMessage.content[0].type).toBe("image_url");
  });

  it("does not add image messages when image is not provided", async () => {
    const mock = makeMockClient(FAKE_RESPONSE);
    const createMock = mock.chat.completions.create as Mock;
    const client = new CustomOpenAIClient({
      modelName: "test-model",
      client: mock,
    });

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "hello" }],
        requestId: "test-3",
      },
      logger: noopLogger,
      retries: 0,
    });

    const body = createMock.mock.calls[0][0];
    const hasImageMessage = body.messages.some(
      (m: { content: unknown }) =>
        Array.isArray(m.content) &&
        m.content.some((c: { type: string }) => c.type === "image_url"),
    );

    expect(hasImageMessage).toBe(false);
  });

  it("does not mutate options.messages when image is provided", async () => {
    const mock = makeMockClient(FAKE_RESPONSE);
    const client = new CustomOpenAIClient({
      modelName: "test-model",
      client: mock,
    });

    const options = {
      messages: [{ role: "user" as const, content: "describe this page" }],
      image: { buffer: Buffer.from("img") },
      requestId: "test-4",
    };

    await client.createChatCompletion({
      options,
      logger: noopLogger,
      retries: 0,
    });

    expect(options.messages).toHaveLength(1);
  });

  it("does not duplicate image messages across retries", async () => {
    const createMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "not json" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { role: "assistant", content: '{"value":"ok"}' } },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    const mock = {
      chat: { completions: { create: createMock } },
    } as unknown as OpenAI;
    const client = new CustomOpenAIClient({
      modelName: "test-model",
      client: mock,
    });

    const options = {
      messages: [{ role: "user" as const, content: "extract value" }],
      image: { buffer: Buffer.from("img") },
      response_model: {
        name: "value",
        schema: z.object({ value: z.string() }),
      },
      requestId: "test-5",
    };

    await client.createChatCompletion({
      options,
      logger: noopLogger,
      retries: 1,
    });

    expect(options.messages).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(2);

    for (const call of createMock.mock.calls) {
      const imageMessageCount = (
        call[0].messages as Array<{ content: unknown }>
      ).filter(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((c: { type: string }) => c.type === "image_url"),
      ).length;
      expect(imageMessageCount).toBe(1);
    }
  });
});
