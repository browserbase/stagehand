import { describe, expect, it, vi } from "vitest";
import { StagehandAPIClient } from "../../lib/v3/api.js";
import type { ActResult } from "../../lib/v3/types/public/index.js";

describe("StagehandAPIClient variable serialization", () => {
  it("preserves rich variables when sending the act request", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      message: "ok",
      actionDescription: "typed",
      actions: [],
    });

    (
      client as unknown as {
        execute: typeof executeMock;
      }
    ).execute = executeMock;

    await client.act({
      input: "type %username% into the email field",
      options: {
        variables: {
          username: {
            value: "john@example.com",
            description: "The login email",
          },
          password: "secret",
        },
      },
    });

    expect(executeMock).toHaveBeenCalledWith({
      method: "act",
      args: {
        input: "type %username% into the email field",
        options: {
          variables: {
            username: {
              value: "john@example.com",
              description: "The login email",
            },
            password: "secret",
          },
        },
        frameId: undefined,
      },
      serverCache: undefined,
    });
  });

  it("preserves screenshot when sending the extract request", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const executeMock = vi.fn().mockResolvedValue({ title: "ok" });

    (
      client as unknown as {
        execute: typeof executeMock;
      }
    ).execute = executeMock;

    await client.extract({
      instruction: "extract the title",
      options: {
        screenshot: true,
      },
    });

    expect(executeMock).toHaveBeenCalledWith({
      method: "extract",
      args: {
        instruction: "extract the title",
        schema: undefined,
        options: {
          screenshot: true,
        },
        frameId: undefined,
      },
      serverCache: undefined,
    });
  });

  it("preserves rich variables when sending the observe request", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const executeMock = vi.fn().mockResolvedValue([]);

    (
      client as unknown as {
        execute: typeof executeMock;
      }
    ).execute = executeMock;

    await client.observe({
      instruction: "find the field where %username% should be entered",
      options: {
        variables: {
          username: {
            value: "john@example.com",
            description: "The login email",
          },
          password: "secret",
        },
        ignoreSelectors: [".cookie-banner"],
      },
    });

    expect(executeMock).toHaveBeenCalledWith({
      method: "observe",
      args: {
        instruction: "find the field where %username% should be entered",
        options: {
          variables: {
            username: {
              value: "john@example.com",
              description: "The login email",
            },
            password: "secret",
          },
          ignoreSelectors: [".cookie-banner"],
        },
        frameId: undefined,
      },
      serverCache: undefined,
    });
  });

  it("sends serverCacheThreshold in the wire options for act", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      message: "ok",
      actionDescription: "clicked",
      actions: [],
    });

    (
      client as unknown as {
        execute: typeof executeMock;
      }
    ).execute = executeMock;

    await client.act({
      input: "click the submit button",
      options: {
        serverCacheThreshold: 5,
        timeout: 30000,
      },
    });

    expect(executeMock).toHaveBeenCalledWith({
      method: "act",
      args: {
        input: "click the submit button",
        options: {
          timeout: 30000,
          serverCacheThreshold: 5,
        },
        frameId: undefined,
      },
      serverCache: undefined,
    });
  });

  it("sends serverCacheThreshold in the wire options for observe and extract", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const executeMock = vi.fn().mockResolvedValue([]);

    (
      client as unknown as {
        execute: typeof executeMock;
      }
    ).execute = executeMock;

    await client.observe({
      instruction: "find the submit button",
      options: { serverCacheThreshold: 0 },
    });

    expect(executeMock).toHaveBeenLastCalledWith({
      method: "observe",
      args: {
        instruction: "find the submit button",
        options: { serverCacheThreshold: 0 },
        frameId: undefined,
      },
      serverCache: undefined,
    });

    executeMock.mockResolvedValue({ title: "ok" });
    await client.extract({
      instruction: "extract the title",
      options: { serverCacheThreshold: 10, serverCache: true },
    });

    expect(executeMock).toHaveBeenLastCalledWith({
      method: "extract",
      args: {
        instruction: "extract the title",
        schema: undefined,
        options: { serverCacheThreshold: 10 },
        frameId: undefined,
      },
      serverCache: true,
    });
  });

  it("preserves rich variables when sending the agentExecute request", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const executeMock = vi.fn().mockResolvedValue({
      success: true,
      message: "ok",
      actions: [],
      completed: true,
    });

    (
      client as unknown as {
        execute: typeof executeMock;
      }
    ).execute = executeMock;

    await client.agentExecute(
      { mode: "dom" },
      {
        instruction: "fill the form with %username% and %password%",
        variables: {
          username: "john@example.com",
          password: {
            value: "secret",
            description: "The login password",
          },
        },
      },
    );

    expect(executeMock).toHaveBeenCalledWith({
      method: "agentExecute",
      args: {
        agentConfig: {
          systemPrompt: undefined,
          mode: "dom",
          cua: undefined,
          model: undefined,
          executionModel: undefined,
        },
        executeOptions: {
          instruction: "fill the form with %username% and %password%",
          variables: {
            username: "john@example.com",
            password: {
              value: "secret",
              description: "The login password",
            },
          },
        },
        frameId: undefined,
        shouldCache: undefined,
      },
    });
  });
});

describe("StagehandAPIClient cache metadata", () => {
  const runAct = async ({
    cacheHit,
    cacheMissReason,
    cacheCount,
    tokensSaved,
    serverCache = true,
    finalEventBuffered = false,
  }: {
    cacheHit: boolean;
    cacheMissReason?: string;
    cacheCount?: number;
    tokensSaved?: { input: number; output: number; total: number };
    serverCache?: boolean;
    finalEventBuffered?: boolean;
  }) => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const event = {
      type: "system",
      data: {
        status: "finished",
        result: {
          success: true,
          message: "ok",
          actionDescription: "clicked",
          actions: [] as ActResult["actions"],
        },
        cacheHit,
        ...(cacheMissReason !== undefined && { cacheMissReason }),
        ...(cacheCount !== undefined && { cacheCount }),
        ...(tokensSaved !== undefined && { tokensSaved }),
      },
    };
    const cacheStatus = cacheHit ? "HIT" : "MISS";
    const eventTerminator = finalEventBuffered ? "" : "\n\n";

    (
      client as unknown as {
        request: () => Promise<Response>;
      }
    ).request = vi.fn().mockResolvedValue(
      new Response(`data: ${JSON.stringify(event)}${eventTerminator}`, {
        headers: { "browserbase-cache-status": cacheStatus },
      }),
    );

    return client.act({
      input: "click the submit button",
      options: { serverCache },
    });
  };

  it("attaches the reason when a cache miss provides one", async () => {
    const result = await runAct({
      cacheHit: false,
      cacheMissReason: "threshold",
      cacheCount: 3,
      tokensSaved: { input: 0, output: 0, total: 0 },
    });

    expect(result.cacheStatus).toBe("MISS");
    expect(result.cacheMissReason).toBe("threshold");
    expect(result.cacheCount).toBe(3);
    expect(result.tokensSaved).toEqual({ input: 0, output: 0, total: 0 });
  });

  it("does not attach a miss reason to a cache hit", async () => {
    const result = await runAct({
      cacheHit: true,
      cacheMissReason: "threshold",
      cacheCount: 8,
      tokensSaved: { input: 120, output: 30, total: 150 },
    });

    expect(result.cacheStatus).toBe("HIT");
    expect(result.cacheMissReason).toBeUndefined();
    expect(result.cacheCount).toBe(8);
    expect(result.tokensSaved).toEqual({
      input: 120,
      output: 30,
      total: 150,
    });
  });

  it("does not attach a miss reason when none is provided", async () => {
    const result = await runAct({ cacheHit: false });

    expect(result.cacheStatus).toBe("MISS");
    expect(result.cacheMissReason).toBeUndefined();
  });

  it("suppresses cache metadata from a final buffered event when caching is disabled", async () => {
    const result = await runAct({
      cacheHit: false,
      cacheMissReason: "threshold",
      cacheCount: 3,
      tokensSaved: { input: 0, output: 0, total: 0 },
      serverCache: false,
      finalEventBuffered: true,
    });

    expect(result.cacheStatus).toBeUndefined();
    expect(result.cacheMissReason).toBeUndefined();
    expect(result.cacheCount).toBeUndefined();
    expect(result.tokensSaved).toBeUndefined();
  });
});
