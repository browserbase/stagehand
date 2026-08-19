import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CodeModeRunInputSchema,
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_TOOLS,
} from "@browserbasehq/stagehand-integrations/facade";

import { FLUE_STAGEHAND_INSTRUCTIONS, StagehandAgent } from "../agent/agent.js";
import runTool from "../agent/tools/run.js";
import screenshotTool from "../agent/tools/screenshot.js";
import snapshotTool from "../agent/tools/snapshot.js";

const fakeFacade = vi.hoisted(() => ({
  run: vi.fn(async () => ({ title: "Example Domain" })),
  runActions: vi.fn(async () => ({ completed: 1, url: "https://example.com" })),
  snapshot: vi.fn(async () => "[1-1] link: Example Domain"),
  screenshot: vi.fn(async () => ({
    data: Buffer.from("fake-png").toString("base64"),
    mimeType: "image/png" as const,
  })),
}));

vi.mock("../src/session.js", () => ({
  getFacadeTools: async () => fakeFacade,
  discardFacadeToolsIfUnhealthy: async () => undefined,
}));

const screenshotDirectories = new Set<string>();
const stagehandTools = [runTool, snapshotTool, screenshotTool];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    [...screenshotDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  screenshotDirectories.clear();
});

describe("Flue Stagehand facade tools", () => {
  it("uses the facade descriptions", () => {
    expect(stagehandTools.map((tool) => tool.name)).toEqual(FACADE_TOOLS.map((tool) => tool.name));
    expect(runTool.description).toBe(FACADE_TOOLS[0].description);
    expect(snapshotTool.description).toBe(FACADE_TOOLS[1].description);
    expect(screenshotTool.description).toBe(FACADE_TOOLS[2].description);
  });

  it("keeps the canonical facade instructions", () => {
    expect(FLUE_STAGEHAND_INSTRUCTIONS).toContain(FACADE_AGENT_INSTRUCTIONS);
    expect(FLUE_STAGEHAND_INSTRUCTIONS).toContain("temporary local file path");
    expect(FLUE_STAGEHAND_INSTRUCTIONS).toContain("Report that path");
  });

  it("validates run input before opening a browser", async () => {
    expect(CodeModeRunInputSchema.safeParse({ code: "return 1;" }).success).toBe(true);
    await expect(runTool.run(runContext({}))).rejects.toThrow(
      "run requires exactly one of code or actions",
    );
    await expect(
      runTool.run(runContext({ code: "return 1;", actions: [{ op: "click", id: "1-1" }] })),
    ).rejects.toThrow("run requires exactly one of code or actions");
  });

  it("routes valid inputs through one facade tool set", async () => {
    await expect(runTool.run(runContext({ code: "return await page.title();" }))).resolves.toBe(
      '{\n  "title": "Example Domain"\n}',
    );
    await expect(
      runTool.run(runContext({ actions: [{ op: "click", id: "1-1" }] })),
    ).resolves.toContain('"completed": 1');
    await expect(snapshotTool.run(snapshotContext({ includeIframes: false }))).resolves.toBe(
      "[1-1] link: Example Domain",
    );

    expect(fakeFacade.run).toHaveBeenCalledWith("return await page.title();");
    expect(fakeFacade.runActions).toHaveBeenCalledWith([{ op: "click", id: "1-1" }]);
    expect(fakeFacade.snapshot).toHaveBeenCalledWith({ includeIframes: false });
  });

  it("writes screenshots to an inspectable temporary file", async () => {
    const result = await screenshotTool.run(screenshotContext({ type: "png" }));
    if (typeof result !== "object" || result === null || !("output" in result)) {
      throw new Error("Expected a screenshot output envelope");
    }

    const output = result.output as { path: string; mimeType: string };
    screenshotDirectories.add(path.dirname(output.path));
    expect(output.mimeType).toBe("image/png");
    await expect(readFile(output.path, "utf8")).resolves.toBe("fake-png");
  });

  it("runs the native tools through a real Flue agent loop", async () => {
    const previousModel = process.env.FLUE_STAGEHAND_MODEL;
    process.env.FLUE_STAGEHAND_MODEL = "faux/faux-1";
    const faux = fauxProvider();
    faux.setResponses([
      (context) => {
        expect(context.tools?.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(FACADE_TOOLS.map((tool) => tool.name)),
        );
        return fauxAssistantMessage(fauxToolCall("run", { code: "return await page.title();" }), {
          stopReason: "toolUse",
        });
      },
      fauxAssistantMessage(fauxText("Example Domain")),
    ]);

    const flue = await start({ agents: [StagehandAgent], providers: [faux.provider] });
    try {
      const agent = init(StagehandAgent, { id: `stagehand-test-${randomUUID()}` });
      const receipt = await agent.dispatch("Open example.com and report its title.");
      const reply = await agent.read(receipt, { signal: AbortSignal.timeout(10_000) });
      expect(reply.text).toBe("Example Domain");
      expect(fakeFacade.run).toHaveBeenCalledWith("return await page.title();");
    } finally {
      await flue.stop();
      if (previousModel === undefined) delete process.env.FLUE_STAGEHAND_MODEL;
      else process.env.FLUE_STAGEHAND_MODEL = previousModel;
    }
  });
});

function runContext(data: unknown): Parameters<typeof runTool.run>[0] {
  return baseContext(data) as Parameters<typeof runTool.run>[0];
}

function snapshotContext(data: unknown): Parameters<typeof snapshotTool.run>[0] {
  return baseContext(data) as Parameters<typeof snapshotTool.run>[0];
}

function screenshotContext(data: unknown): Parameters<typeof screenshotTool.run>[0] {
  return baseContext(data) as Parameters<typeof screenshotTool.run>[0];
}

function baseContext(data: unknown) {
  return {
    data,
    toolCallId: "test-call",
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
}
