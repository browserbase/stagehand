import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_RUN_TOOL_NAME, type AgentMount } from "../../core/contracts/tool.js";
import {
  DEEPAGENTS_RUN_TOOL_NAME,
  rewriteRunToolInstructions,
  startDeepagentsCodeBridge,
} from "../../framework/deepagentsCodeBridge.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

const plan = {
  dataset: "webvoyager",
  taskId: "demo",
  startUrl: "https://example.com",
  instruction: "find the thing",
} as ExternalHarnessTaskPlan;

function mountWith(handles: Record<string, unknown>): Extract<AgentMount, { via: "handles" }> {
  return {
    via: "handles",
    handles,
    promptInstructions: `Use the ${AGENT_RUN_TOOL_NAME} tool.`,
    runTool: {
      description: "Execute JavaScript against the surface.",
      codeParamDescription: "JavaScript function body.",
      denyMessage: `Use ${AGENT_RUN_TOOL_NAME}.`,
    },
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startBridge(
  handles: Record<string, unknown>,
  onRunExecuted?: () => Promise<void>,
): Promise<Client> {
  const bridge = await startDeepagentsCodeBridge({
    mount: mountWith(handles),
    plan,
    logger: new EvalLogger(false),
    ...(onRunExecuted && { onRunExecuted }),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: bridge.mcpServerSpec.command,
      args: bridge.mcpServerSpec.args,
      env: bridge.mcpServerSpec.env,
    }),
  );
  cleanups.push(async () => {
    try {
      await client.close();
    } catch {
      // the relay may already be gone
    }
    await bridge.close();
  });
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((part) => part.text ?? "").join("\n");
}

describe("deepagents code bridge", () => {
  it("exposes the run tool under the name langchain reports", async () => {
    const client = await startBridge({});
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([DEEPAGENTS_RUN_TOOL_NAME]);
    expect(tools[0].inputSchema.required).toEqual(["code"]);
  });

  it("binds handles, startUrl and task into snippet scope", async () => {
    const calls: string[] = [];
    const page = { calls, goto: (url: string): void => void calls.push(url) };
    const client = await startBridge({ page });
    const result = await client.callTool({
      name: DEEPAGENTS_RUN_TOOL_NAME,
      arguments: {
        code: "await page.goto(startUrl); return { id: task.id, visited: page.calls };",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      id: "demo",
      visited: ["https://example.com"],
    });
  });

  it("reports snippet failures as tool errors without killing the bridge", async () => {
    const client = await startBridge({});
    const failed = await client.callTool({
      name: DEEPAGENTS_RUN_TOOL_NAME,
      arguments: { code: "throw new Error('snippet exploded');" },
    });
    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toContain("snippet exploded");

    const after = await client.callTool({
      name: DEEPAGENTS_RUN_TOOL_NAME,
      arguments: { code: "return 'still alive';" },
    });
    expect(after.isError).toBeFalsy();
    expect(textOf(after)).toBe("still alive");
  });

  it("probes after every run, including failed ones", async () => {
    let probes = 0;
    const client = await startBridge({}, async () => {
      probes += 1;
    });
    await client.callTool({ name: DEEPAGENTS_RUN_TOOL_NAME, arguments: { code: "return 1;" } });
    await client.callTool({
      name: DEEPAGENTS_RUN_TOOL_NAME,
      arguments: { code: "throw new Error('x');" },
    });
    expect(probes).toBe(2);
  });

  it("rewrites the surface's claude-flavored run tool name", () => {
    expect(rewriteRunToolInstructions(`Use the ${AGENT_RUN_TOOL_NAME} tool.`)).toBe(
      "Use the run tool.",
    );
  });
});
