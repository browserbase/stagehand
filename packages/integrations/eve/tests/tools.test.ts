import type { ToolContext } from "eve/tools";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CodeModeRunInputSchema,
  FACADE_AGENT_INSTRUCTIONS,
  RUN_INPUT_SCHEMA,
  RUN_TOOL_DESCRIPTION,
  SCREENSHOT_INPUT_SCHEMA,
  SCREENSHOT_TOOL_DESCRIPTION,
  SNAPSHOT_INPUT_SCHEMA,
  SNAPSHOT_TOOL_DESCRIPTION,
} from "../extension/lib/core-facade/contract.js";
import runTool from "../extension/tools/run.js";
import screenshotTool from "../extension/tools/screenshot.js";
import snapshotTool from "../extension/tools/snapshot.js";

const fakeContext = {} as ToolContext;

describe("Eve Stagehand facade tools", () => {
  it("uses the canonical facade descriptions", () => {
    expect(runTool.description).toBe(RUN_TOOL_DESCRIPTION);
    expect(runTool.description).toContain('never "kind"');
    expect(snapshotTool.description).toBe(SNAPSHOT_TOOL_DESCRIPTION);
    expect(screenshotTool.description).toBe(SCREENSHOT_TOOL_DESCRIPTION);
  });

  it("uses the canonical facade input schemas", () => {
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

it("includes the canonical facade instructions and Eve close lifecycle", () => {
  const file = readFileSync(
    new URL("../extension/instructions/browser.md", import.meta.url),
    "utf8",
  );
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ");

  expect(normalize(file)).toContain(normalize(FACADE_AGENT_INSTRUCTIONS));
  expect(file).toContain("await browser.close()");
});
