import { describe, expect, it, vi } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { runFlueSession } from "../src/index.js";
import { bridgeFlueMcpTools } from "../src/mcp-bridge.js";

describe("Flue MCP schema bridge", () => {
  it("preserves nested schemas, arguments, and MCP errors in a native Flue run", async () => {
    const inputSchema = {
      type: "object" as const,
      properties: {
        code: { type: "string", minLength: 1 },
        options: {
          type: "object",
          properties: { mode: { enum: ["read", "write"] } },
        },
      },
      required: ["code"],
      additionalProperties: false,
    };
    const callTool = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "Invalid browser action" }],
      isError: true,
    }));
    const bridge = await bridgeFlueMcpTools("browser", {
      tools: [{ name: "run", description: "Execute browser code", inputSchema }],
      callTool,
    });
    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("mcp__browser__run", {
          code: "return 1",
          options: { mode: "read" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("done")),
    ]);
    try {
      const result = await runFlueSession({
        prompt: "Run browser code",
        model: "faux/faux-1",
        logger: { log() {}, warn() {}, error() {} },
        session: { tools: bridge.tools, instructions: "Use the browser." },
        startRuntime: async ({ agents }) => {
          const { start } = await import("@flue/runtime/node");
          return start({ agents, providers: [faux.provider] });
        },
      });
      expect(result.status).toBe("completed");
      expect(callTool).toHaveBeenCalledWith(
        "run",
        { code: "return 1", options: { mode: "read" } },
        expect.any(AbortSignal),
      );
      const request = result.events.find((event) => event.type === "turn_request");
      expect(request).toMatchObject({
        request: {
          input: {
            tools: expect.arrayContaining([
              expect.objectContaining({
                name: "mcp__browser__run",
                parameters: inputSchema,
              }),
            ]),
          },
        },
      });
      expect(result.events.find((event) => event.type === "tool")).toMatchObject({
        isError: true,
      });
    } finally {
      await bridge.close();
    }
  });
});
