import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ALL_TOOLS, type AgentToolContext } from "../../lib/tools/index.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

function createToolContext(
  overrides: Partial<AgentToolContext> = {},
): AgentToolContext {
  return {
    workspace: process.cwd(),
    ...overrides,
  };
}

async function runTool(
  toolName: keyof typeof ALL_TOOLS,
  input: unknown,
  overrides: Partial<AgentToolContext> = {},
) {
  const tool = ALL_TOOLS[toolName];
  const context = createToolContext(overrides);
  const parsedInput = tool.inputSchema.parse(input);
  const output = await tool.execute(parsedInput, context);
  return tool.outputSchema.parse(output);
}

describe("ALL_TOOLS", () => {
  test("reads text-like artifacts from the workspace", async () => {
    const rootDir = path.join(
      process.cwd(),
      "packages/agent/.tmp/tools-text-artifact",
    );
    createdDirs.push(rootDir);
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, "note.txt"), "hello from workspace", "utf8");

    const result = await runTool(
      "functions_view_image_or_document",
      {
        path: "note.txt",
        ocr: false,
      },
      { workspace: rootDir },
    );

    expect(result.ok).toBe(true);
    expect(result.exists).toBe(true);
    expect(result.kind).toBe("text");
    expect(result.text).toContain("hello from workspace");
  });

  test("returns stable metadata for unknown async wait ids", async () => {
    const rootDir = path.join(
      process.cwd(),
      "packages/agent/.tmp/tools-wait",
    );
    createdDirs.push(rootDir);
    await fs.mkdir(rootDir, { recursive: true });

    const result = await runTool(
      "functions_wait",
      {
        ids: ["agent-missing"],
        timeout_ms: 25,
      },
      { workspace: rootDir },
    );

    expect(result).toEqual({
      ok: true,
      completed: true,
      timeout_ms: 25,
      results: [
        {
          id: "agent-missing",
          status: "unknown",
          error: "Unknown task id: agent-missing",
        },
      ],
    });
  });

  test("rejects conflicting plan updates in one parallel batch", async () => {
    const result = await runTool("multi_tool_use_parallel", {
      tool_uses: [
        {
          recipient_name: "functions_update_plan",
          parameters: {
            plan: [{ step: "first plan", status: "completed" }],
          },
        },
        {
          recipient_name: "functions_update_plan",
          parameters: {
            plan: [{ step: "second plan", status: "completed" }],
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("plan");
  });

  test("dispatches disjoint parallel calls through ALL_TOOLS", async () => {
    const rootDir = path.join(
      process.cwd(),
      "packages/agent/.tmp/tools-parallel",
    );
    createdDirs.push(rootDir);
    await fs.mkdir(rootDir, { recursive: true });

    const result = await runTool(
      "multi_tool_use_parallel",
      {
        tool_uses: [
          {
            recipient_name: "functions_exec_command",
            parameters: { cmd: "printf 'hi'" },
          },
          {
            recipient_name: "functions_update_plan",
            parameters: {
              explanation: "parallel test",
              plan: [{ step: "run two tools", status: "completed" }],
            },
          },
        ],
      },
      { workspace: rootDir },
    );

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      recipient_name: "functions_exec_command",
      ok: true,
    });
    expect(result.results[1]).toEqual({
      recipient_name: "functions_update_plan",
      ok: true,
      output: {
        ok: true,
        explanation: "parallel test",
        plan: [{ step: "run two tools", status: "completed" }],
      },
    });
  });
});
