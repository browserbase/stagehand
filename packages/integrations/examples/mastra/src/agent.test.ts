import assert from "node:assert/strict";
import test from "node:test";

import type { MCPClient } from "@mastra/mcp";

import {
  loadStagehandCodeTools,
  StagehandMastraSetupError,
  StagehandMastraToolContractError,
} from "./agent.js";

const canonicalDescription = "# Stagehand V4 code-mode syntax\nUse the persistent page.";
const codeExecute = { description: canonicalDescription, execute: async () => undefined };

void test("accepts exactly one canonical code_execute tool", async () => {
  const tools = await loadStagehandCodeTools(
    fakeMcp({ toolsets: { stagehand: { code_execute: codeExecute } }, errors: {} }),
  );
  assert.equal(tools.code_execute, codeExecute);
});

void test("sanitizes transport discovery errors", async () => {
  const secret = "https://sandbox.example.test/mcp?token=do-not-reflect";
  const mcp = {
    listToolsetsWithErrors: async () => {
      throw new Error(secret);
    },
  } as unknown as MCPClient;

  await assert.rejects(loadStagehandCodeTools(mcp), (error: unknown) => {
    assert.ok(error instanceof StagehandMastraSetupError);
    assert.equal(error.message, "Could not configure the Mastra Stagehand agent.");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

void test("sanitizes resolved MCP discovery errors", async () => {
  const secret = "https://sandbox.example.test/mcp?token=do-not-reflect";

  await assert.rejects(
    loadStagehandCodeTools(
      fakeMcp({
        toolsets: {},
        errors: { stagehand: new Error(secret) },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof StagehandMastraSetupError);
      assert.equal(error.message, "Could not configure the Mastra Stagehand agent.");
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

void test("rejects non-canonical toolsets with a fixed typed error", async () => {
  await assert.rejects(
    loadStagehandCodeTools(
      fakeMcp({
        toolsets: { stagehand: { unexpected_secret_tool: codeExecute } },
        errors: {},
      }),
    ),
    {
      name: StagehandMastraToolContractError.name,
      message: "The Stagehand MCP server returned an invalid tool contract.",
    },
  );
});

function fakeMcp(result: unknown): MCPClient {
  return {
    listToolsetsWithErrors: async () => result,
  } as unknown as MCPClient;
}
