import type { ToolContext } from "eve/tools";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FACADE_AGENT_INSTRUCTIONS,
  CodeModeRunInputSchema,
  RUN_INPUT_SCHEMA,
  RUN_TOOL_DESCRIPTION,
  SCREENSHOT_INPUT_SCHEMA,
  SCREENSHOT_TOOL_DESCRIPTION,
  SNAPSHOT_INPUT_SCHEMA,
  SNAPSHOT_TOOL_DESCRIPTION,
} from "@browserbasehq/stagehand-integrations/facade";
import runTool from "../agent/tools/run.js";
import screenshotTool from "../agent/tools/screenshot.js";
import snapshotTool from "../agent/tools/snapshot.js";
import { discardFacadeToolsIfUnhealthy } from "../src/session.js";

const fakeContext = {} as ToolContext;

describe("Eve Stagehand facade tools", () => {
  it("exports the connection health discard helper", () => {
    expect(discardFacadeToolsIfUnhealthy).toBeTypeOf("function");
  });

  it("uses the facade descriptions", () => {
    expect(runTool.description).toBe(RUN_TOOL_DESCRIPTION);
    expect(runTool.description).toContain('never "kind"');
    expect(snapshotTool.description).toBe(SNAPSHOT_TOOL_DESCRIPTION);
    expect(screenshotTool.description).toBe(SCREENSHOT_TOOL_DESCRIPTION);
  });

  it("uses the facade input schemas", () => {
    expect(runTool.inputSchema).toBe(RUN_INPUT_SCHEMA);
    expect(snapshotTool.inputSchema).toBe(SNAPSHOT_INPUT_SCHEMA);
    expect(screenshotTool.inputSchema).toBe(SCREENSHOT_INPUT_SCHEMA);
  });

  it("validates run input before opening a browser", async () => {
    await expect(runTool.execute({}, fakeContext)).rejects.toThrow();
    await expect(
      runTool.execute({ code: "return 1;", actions: [{ op: "click", id: "1-1" }] }, fakeContext),
    ).rejects.toThrow();
    expect(CodeModeRunInputSchema.safeParse({ code: "return 1;" }).success).toBe(true);
  });
});

it("keeps instructions.md identical to the canonical facade prompt", () => {
  const file = readFileSync(new URL("../agent/instructions.md", import.meta.url), "utf8");
  expect(file.trim()).toBe(FACADE_AGENT_INSTRUCTIONS.trim());
});
