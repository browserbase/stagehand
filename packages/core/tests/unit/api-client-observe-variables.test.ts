import { describe, expect, it, vi } from "vitest";
import { StagehandAPIClient } from "../../lib/v3/api.js";

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
        },
        frameId: undefined,
      },
      serverCache: undefined,
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
