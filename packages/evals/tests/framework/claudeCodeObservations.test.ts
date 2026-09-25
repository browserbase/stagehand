import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_RUN_TOOL_SERVER, type AgentMount } from "../../core/contracts/tool.js";
import { prepareClaudeCodeToolAdapter } from "../../framework/claudeCodeToolAdapter.js";
import { EvalLogger } from "../../logger.js";

const { startAgentToolRuntimeMock } = vi.hoisted(() => ({
  startAgentToolRuntimeMock: vi.fn(),
}));

vi.mock("../../framework/agentToolRuntime.js", () => ({
  startAgentToolRuntime: startAgentToolRuntimeMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  startAgentToolRuntimeMock.mockReset();
});

describe.each(["handles", "mcp"] as const)("Claude Code %s observations", (via) => {
  it.each([undefined, "all", "none"])(
    "honors EVAL_HARNESS_OBSERVATIONS=%s and preserves final evidence",
    async (mode) => {
      vi.stubEnv("EVAL_HARNESS_OBSERVATIONS", mode);
      const evidence = { url: "https://example.com" };
      const captureEvidence = vi.fn(async () => evidence);
      const title = vi.fn(async () => "Example");
      const agentMount: AgentMount =
        via === "handles"
          ? {
              via,
              promptInstructions: "Use page to browse.",
              handles: { page: { title } },
              runTool: {
                description: "Run browser code",
                codeParamDescription: "JavaScript using page",
                denyMessage: "Use the run tool",
              },
            }
          : {
              via,
              promptInstructions: "Use the browser MCP server.",
              mcpServers: { browser: { command: "node", args: ["browser-server.js"] } },
            };
      startAgentToolRuntimeMock.mockResolvedValue({
        running: { agentMount, captureEvidence },
        cleanup: async (): Promise<void> => undefined,
      });
      const adapter = await prepareClaudeCodeToolAdapter({
        toolSurface: via === "handles" ? "playwright_code" : "playwright_mcp",
        startupProfile: "runner_provided_local_cdp",
        environment: "LOCAL",
        plan: {
          dataset: "webvoyager",
          startUrl: evidence.url,
          instruction: "Read the page title",
        },
        logger: new EvalLogger(false),
      });
      const client = new Client({ name: "observation-test", version: "1.0.0" });
      try {
        if (via === "handles") {
          const server = adapter.mcpServers![
            AGENT_RUN_TOOL_SERVER
          ] as McpSdkServerConfigWithInstance;
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          await server.instance.connect(serverTransport);
          await client.connect(clientTransport);
          const result = await client.callTool({
            name: "run",
            arguments: { code: "return await page.title();" },
          });
          expect(result).toMatchObject({ content: [{ type: "text", text: "Example" }] });
          expect(result.isError).not.toBe(true);
          expect(title).toHaveBeenCalledOnce();
        } else {
          adapter.onToolResult?.("Bash");
          adapter.onToolResult?.("mcp__unrelated__navigate");
          expect(captureEvidence).not.toHaveBeenCalled();
          adapter.onToolResult?.("mcp__browser__navigate");
        }

        const observations = await adapter.drainStepObservations?.();
        if (mode === "none") {
          expect(captureEvidence).not.toHaveBeenCalled();
          expect(observations).toBeUndefined();
          expect(adapter.onToolResult).toBeUndefined();
        } else {
          expect(captureEvidence).toHaveBeenCalledOnce();
          expect(observations).toEqual([{ runIndex: 0, evidence }]);
        }

        expect(await adapter.captureEvidence?.()).toEqual(evidence);
        expect(captureEvidence).toHaveBeenCalledTimes(mode === "none" ? 1 : 2);
      } finally {
        await client.close();
        await adapter.cleanup();
      }
    },
  );
});
