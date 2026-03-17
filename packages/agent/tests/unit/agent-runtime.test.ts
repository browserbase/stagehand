import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Agent } from "../../lib/agent.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("Agent runtime tool dispatch", () => {
  test("dispatches function tools without owning browser runtime state", async () => {
    const rootDir = path.join(
      process.cwd(),
      "packages/agent/.tmp/agent-runtime",
    );
    createdDirs.push(rootDir);

    const agent = new Agent({
      modelName: "openai/test-model",
      workspace: rootDir,
    });

    await (agent as { ready: Promise<void> }).ready;

    const result = await (
      agent as {
        dispatchToolCall: (toolName: string, input: unknown) => Promise<unknown>;
      }
    ).dispatchToolCall("functions_update_plan", {
      explanation: "runtime test",
      plan: [{ step: "keep browser logic in browse CLI", status: "completed" }],
    });

    expect(result).toEqual({
      ok: true,
      explanation: "runtime test",
      plan: [{ step: "keep browser logic in browse CLI", status: "completed" }],
    });

    await agent.close();
  });
});
