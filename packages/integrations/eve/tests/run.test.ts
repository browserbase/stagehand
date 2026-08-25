import type { ExperimentalBatchContext } from "@browserbasehq/stagehand";
import { describe, expect, it, vi } from "vitest";

import { compileRunCallback, runStagehandCode } from "../extension/lib/run.js";
import { StagehandSession, type StagehandResources } from "../extension/lib/session.js";

describe("Stagehand run", () => {
  it("compiles a closure-free callback in the host process", async () => {
    const callback = compileRunCallback(
      'return { title: await page.title(), observed: await observe("the heading") };',
    );
    const source = callback.toString();
    const batch = createBatch();

    expect(source).toContain('await observe("the heading")');
    expect(source).not.toMatch(/AsyncFunction|new Function|eval\(/u);
    await expect(callback(batch, {})).resolves.toMatchObject({
      value: { title: "Example Domain", observed: "heading" },
      closeRequested: false,
    });
  });

  it("propagates close requests to host cleanup", async () => {
    const resources = createResources();
    const replacement = createResources();
    const factory = vi
      .fn<() => Promise<StagehandResources>>()
      .mockResolvedValueOnce(resources)
      .mockResolvedValueOnce(replacement);
    const cleanup = vi.fn(async () => {
      markClosed(resources);
    });
    const session = new StagehandSession(factory, cleanup);

    await expect(runStagehandCode('await close(); return "closed";', session)).resolves.toBe(
      "closed",
    );
    await expect(session.run(async (current) => current === replacement)).resolves.toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(resources);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("closes the browser before surfacing a model-authored error", async () => {
    const resources = createResources();
    const cleanup = vi.fn(async () => {
      markClosed(resources);
    });
    const session = new StagehandSession(async () => resources, cleanup);

    await expect(
      runStagehandCode('await close(); throw new Error("boom");', session),
    ).rejects.toThrow("boom");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves a healthy session after model-authored code throws", async () => {
    const resources = createResources();
    const factory = vi.fn(async () => resources);
    const cleanup = vi.fn();
    const session = new StagehandSession(factory, cleanup);

    await expect(runStagehandCode('throw new Error("expected");', session)).rejects.toThrow(
      "expected",
    );
    await expect(runStagehandCode('return "recovered";', session)).resolves.toBe("recovered");
    expect(factory).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });
});

function createBatch(): ExperimentalBatchContext {
  const batch = Object.create(null) as ExperimentalBatchContext;
  return Object.assign(batch, {
    page: { title: vi.fn(async () => "Example Domain") },
    context: {},
    act: vi.fn(),
    observe: vi.fn(async () => "heading"),
    extract: vi.fn(),
    metrics: vi.fn(),
  });
}

function markClosed(resources: StagehandResources): void {
  Object.defineProperty(resources.browser, "closed", { value: true, configurable: true });
}

function createResources(): StagehandResources {
  const batch = createBatch();
  const browser = {
    closed: false,
    context: { pages: vi.fn(async () => [{}]) },
    close: vi.fn(),
  };
  const resources = Object.create(null) as StagehandResources;
  return Object.assign(resources, {
    browser,
    stagehand: {
      experimentalBatch: vi.fn(async (callback, input) => callback(batch, input)),
      close: vi.fn(),
    },
  });
}
