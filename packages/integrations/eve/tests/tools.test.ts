import type { ToolContext } from "eve/tools";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodeModeRunInputSchema,
  FACADE_AGENT_INSTRUCTIONS,
  RUN_INPUT_SCHEMA,
  RUN_TOOL_DESCRIPTION,
  SCREENSHOT_INPUT_SCHEMA,
  SCREENSHOT_TOOL_DESCRIPTION,
  SNAPSHOT_INPUT_SCHEMA,
  SNAPSHOT_TOOL_DESCRIPTION,
} from "../extension/lib/core/facade/contract.js";
import runTool from "../extension/tools/run.js";
import screenshotTool from "../extension/tools/screenshot.js";
import snapshotTool from "../extension/tools/snapshot.js";
import {
  stagehandSession,
  StagehandSession,
  type StagehandResources,
} from "../extension/lib/session.js";

const fakeContext = {} as ToolContext;

afterEach(() => vi.restoreAllMocks());

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

  it("validates snapshot input and delegates valid calls", async () => {
    const snapshot = vi.fn(async () => "snapshot tree");
    const run = vi
      .spyOn(stagehandSession, "run")
      .mockImplementation(async (operation) => operation({ tools: { snapshot } } as never));

    await expect(snapshotTool.execute({ includeIframes: false }, fakeContext)).resolves.toBe(
      "snapshot tree",
    );
    expect(snapshot).toHaveBeenCalledWith({ includeIframes: false });

    await expect(
      snapshotTool.execute({ includeIframes: "yes" } as never, fakeContext),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
  });

  it("delegates screenshot options and preserves image data for Eve", async () => {
    const resources = screenshotResources();
    const session = new StagehandSession(async () => resources);
    const run = vi
      .spyOn(stagehandSession, "run")
      .mockImplementation((operation) => session.run(operation));
    const options = { fullPage: true, type: "jpeg" as const, quality: 75 };
    const result = await screenshotTool.execute(options, fakeContext);
    if (!("data" in result)) throw new Error("Expected one screenshot, not a stream");

    expect(resources.tools.screenshot).toHaveBeenCalledWith(options);
    expect(result).toEqual({ data: "image-data", mimeType: "image/jpeg" });
    expect(screenshotTool.toModelOutput?.(result)).toMatchObject({
      type: "content",
      value: [
        { type: "text", text: "Screenshot captured." },
        { type: "file", data: { type: "data", data: "image-data" }, mediaType: "image/jpeg" },
      ],
    });
    await expect(screenshotTool.execute({ quality: true } as never, fakeContext)).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
  });

  it("cleans up a failed screenshot's unhealthy session and retries with a new browser", async () => {
    const first = screenshotResources();
    const second = screenshotResources();
    vi.mocked(first.tools.screenshot).mockImplementation(async () => {
      Object.defineProperty(first.browser, "closed", { value: true });
      throw new Error("screenshot connection lost");
    });
    const factory = vi
      .fn<() => Promise<StagehandResources>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const session = new StagehandSession(factory);
    vi.spyOn(stagehandSession, "run").mockImplementation((operation) => session.run(operation));

    await expect(screenshotTool.execute({}, fakeContext)).rejects.toThrow(
      "screenshot connection lost",
    );
    expect(first.stagehand.close).toHaveBeenCalledOnce();
    expect(first.browser.close).toHaveBeenCalledOnce();
    await expect(screenshotTool.execute({}, fakeContext)).resolves.toMatchObject({
      data: "image-data",
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

function screenshotResources(): StagehandResources {
  return Object.assign(Object.create(null) as StagehandResources, {
    browser: { closed: false, close: vi.fn(async () => undefined) },
    stagehand: { close: vi.fn(async () => undefined) },
    tools: { screenshot: vi.fn(async () => ({ data: "image-data", mimeType: "image/jpeg" })) },
  });
}

it("includes the canonical facade instructions and Eve close lifecycle", () => {
  const file = readFileSync(
    new URL("../extension/instructions/browser.md", import.meta.url),
    "utf8",
  );
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ");

  expect(normalize(file)).toContain(normalize(FACADE_AGENT_INSTRUCTIONS));
  expect(normalize(file)).toContain("action `id` values omit the brackets");
  expect(file).toContain("await browser.close()");
});
