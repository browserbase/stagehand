import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StagehandCodeExecutor } from "../src/codemode/executor.js";
import { createCodeModeMcpServer } from "../src/codemode/mcp-server.js";
import type { CodeExecuteResult } from "../src/codemode/types.js";

describe("code-mode MCP server", () => {
  let client: Client;
  let server: ReturnType<typeof createCodeModeMcpServer>;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    execute = vi.fn();
    server = createCodeModeMcpServer({ execute } as unknown as StagehandCodeExecutor);
    client = new Client({ name: "stagehand-codemode-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("advertises exactly one tool with complete input and output schemas", async () => {
    const tools = await client.listTools();

    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]).toMatchObject({
      name: "code_execute",
      inputSchema: {
        type: "object",
        required: ["code"],
        properties: { code: { type: "string" } },
      },
      outputSchema: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: {},
          page: {},
          value: {},
          logs: {},
          error: {},
        },
      },
    });
  });

  it("rejects invalid input before invoking the executor", async () => {
    const response = await client.callTool({
      name: "code_execute",
      arguments: { code: "   " },
    });

    expect(response).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: expect.stringContaining("code must contain JavaScript source"),
        },
      ],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      result: {
        ok: true,
        page: { url: "https://example.com", title: "Example" },
        value: { answer: 42 },
      } satisfies CodeExecuteResult,
      isError: false,
    },
    {
      result: {
        ok: false,
        error: { kind: "runtime", name: "Error", message: "failed" },
      } satisfies CodeExecuteResult,
      isError: true,
    },
  ])("returns structured and text results for ok=$result.ok", async ({ result, isError }) => {
    execute.mockResolvedValueOnce(result);

    const response = await client.callTool({
      name: "code_execute",
      arguments: { code: "return 42;" },
    });

    expect(response.structuredContent).toStrictEqual(result);
    expect(response.isError).toBe(isError);
    expect(response.content).toStrictEqual([
      { type: "text", text: JSON.stringify(result, null, 2) },
    ]);
    expect(execute).toHaveBeenCalledWith({ code: "return 42;" }, expect.any(AbortSignal));
  });
});
