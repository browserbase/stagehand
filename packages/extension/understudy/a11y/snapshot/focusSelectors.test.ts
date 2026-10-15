import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { Progress } from "../../progress.js";
import {
  resolveCssFocusFrameAndTail,
  resolveFocusFrameAndTail,
  resolveObjectIdForCss,
  resolveObjectIdForXPath,
} from "./focusSelectors.js";
import {
  decodeLocatorQuery,
  encodeLocatorQuery,
  type QueryStep,
} from "@browserbasehq/stagehand-protocol/locator-query";
import type { Frame } from "../../frame.js";
import type { Page } from "../../page.js";
import { FrameLocator } from "../../frameLocator.js";
import { resolveLocatorTarget } from "../../deepLocator.js";

function snapshotFrameChain(depth: number) {
  const parentByFrame = new Map<string, string | null>([["root", null]]);
  const sessions = Array.from({ length: depth + 1 }, (_, index) => {
    const frameId = index ? `child-${index}` : "root";
    if (index) parentByFrame.set(frameId, index === 1 ? "root" : `child-${index - 1}`);
    const send = vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate") return { result: { objectId: `iframe-${frameId}` } };
      if (method === "DOM.requestNode") return { nodeId: 5 };
      if (method === "DOM.describeNode") return { node: { backendNodeId: 5 } };
      if (method === "DOM.getFrameOwner") return { backendNodeId: 5 };
      return {};
    });
    return { frameId, send };
  });
  const page = {
    getSessionForFrame: (frameId: string) =>
      sessions.find((session) => session.frameId === frameId),
  } as unknown as Page;
  return { page, parentByFrame, sessions };
}

describe("snapshot focus resolution", () => {
  let progress: Progress;
  let waitForWorld: MockInstance;
  beforeEach(() => {
    vi.useFakeTimers();
    progress = new Progress("snapshot", 10);
    waitForWorld = vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 1,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
  });
  afterEach(() => {
    progress.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["css", resolveObjectIdForCss, "selector"],
    ["xpath", resolveObjectIdForXPath, "selector"],
    ["semantic", resolveObjectIdForCss, encodeLocatorQuery([{ kind: "role", role: "button" }])],
  ] as const)(
    "releases a late %s reference using the caller's deadline",
    async (_, resolve, selector) => {
      let respond!: (value: Protocol.Runtime.EvaluateResponse) => void;
      const response = new Promise<Protocol.Runtime.EvaluateResponse>((done) => {
        respond = done;
      });
      const send = vi.fn(async (method: string) => (method === "Runtime.evaluate" ? response : {}));
      const session = { send } as unknown as CDPSessionLike;
      const read = resolve(session, selector, "frame", 0, progress);
      const timedOut = expect(read).rejects.toThrow(/snapshot timed out/);
      await vi.advanceTimersByTimeAsync(10);
      await timedOut;
      expect(waitForWorld).toHaveBeenCalledWith(session, "frame", 800, progress, {
        readinessRetries: "none",
      });
      respond({ result: { type: "object", objectId: "late-node" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "late-node" });
    },
  );

  it("keeps semantic frame scope and quoted text together", async () => {
    const frame = { frameId: "root" } as Frame;
    const page = { frameForId: () => frame } as unknown as Page;
    const selector = encodeLocatorQuery([
      { kind: "role", role: "button", options: { name: "Save >> publish" } },
    ]);
    await expect(
      resolveCssFocusFrameAndTail(page, selector, new Map(), "root", progress),
    ).resolves.toEqual({
      targetFrameId: "root",
      tailSelector: selector,
      absPrefix: "",
    });
  });

  it.each([
    ["/html/body/iframe[1]/html/body/section", "/html/body/iframe[1]", 1],
    [
      "/html/body/iframe[1]/html/iframe[2]/html/body/section",
      "/html/body/iframe[1]/html/iframe[2]",
      2,
    ],
  ] as const)(
    "retains the canonical frame prefix for semantic XPath scope %s",
    async (xpath, prefix, depth) => {
      const { page, parentByFrame, sessions } = snapshotFrameChain(depth);
      const steps: QueryStep[] = [
        { kind: "selector", selector: `xpath=${xpath}` },
        { kind: "role", role: "button", options: { name: "Save >> publish" } },
      ];
      const result = await resolveCssFocusFrameAndTail(
        page,
        encodeLocatorQuery(steps),
        parentByFrame,
        "root",
        progress,
      );
      expect(result).toMatchObject({ targetFrameId: `child-${depth}`, absPrefix: prefix });
      expect(decodeLocatorQuery(result.tailSelector)).toEqual([
        { kind: "selector", selector: "xpath=/html/body/section" },
        steps[1],
      ]);
      expect(waitForWorld).toHaveBeenCalledTimes(depth);
      for (const session of sessions.slice(0, -1)) {
        expect(waitForWorld).toHaveBeenCalledWith(session, session.frameId, 1000, progress, {
          readinessRetries: "none",
        });
        expect(session.send).toHaveBeenLastCalledWith("Runtime.releaseObject", {
          objectId: `iframe-${session.frameId}`,
        });
      }
    },
  );

  it("keeps a legacy terminal XPath iframe scoped to its child document", async () => {
    const { page, parentByFrame } = snapshotFrameChain(1);
    await expect(
      resolveFocusFrameAndTail(page, "//iframe[1]", parentByFrame, "root", progress),
    ).resolves.toEqual({
      targetFrameId: "child-1",
      tailXPath: "/",
      absPrefix: "//iframe[1]",
    });
  });

  it.each([false, true])(
    "releases failed iframe query objects (progress: %s)",
    async (withProgress) => {
      const { page, parentByFrame, sessions } = snapshotFrameChain(1);
      sessions[0].send.mockImplementation(async (method) =>
        method === "Runtime.evaluate"
          ? { result: { objectId: "error" }, exceptionDetails: { text: "Invalid selector" } }
          : {},
      );
      const selector = encodeLocatorQuery([
        { kind: "selector", selector: "iframe >> section" },
        { kind: "role", role: "button" },
      ]);
      await expect(
        resolveCssFocusFrameAndTail(
          page,
          selector,
          parentByFrame,
          "root",
          withProgress ? progress : undefined,
        ),
      ).rejects.toThrow("Failed to resolve iframe element");
      expect(sessions[0].send).toHaveBeenLastCalledWith("Runtime.releaseObject", {
        objectId: "error",
      });
    },
  );

  it("does not retry an unavailable iframe locator world", async () => {
    const { page, parentByFrame, sessions } = snapshotFrameChain(1);
    const error = new Error("Execution context was destroyed");
    waitForWorld.mockRejectedValue(error);
    const selector = encodeLocatorQuery([
      { kind: "selector", selector: "iframe >> section" },
      { kind: "role", role: "button" },
    ]);
    await expect(
      resolveCssFocusFrameAndTail(page, selector, parentByFrame, "root", progress),
    ).rejects.toBe(error);
    expect(waitForWorld).toHaveBeenCalledExactlyOnceWith(sessions[0], "root", 1000, progress, {
      readinessRetries: "none",
    });
    expect(sessions[0].send).not.toHaveBeenCalled();
  });

  it("keeps a terminal iframe in its parent frame for both actions and snapshots", async () => {
    const frame = { frameId: "root" } as Frame;
    const page = { frameForId: () => frame } as unknown as Page;
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame");
    const selector = encodeLocatorQuery([
      { kind: "selector", selector: "xpath=//iframe[1]" },
      { kind: "role", role: "button" },
    ]);
    const actionTarget = await resolveLocatorTarget(page, frame, selector, progress);
    const snapshotTarget = await resolveCssFocusFrameAndTail(
      page,
      selector,
      new Map([["root", null]]),
      "root",
      progress,
    );
    expect(actionTarget).toEqual({ frame, selector });
    expect(snapshotTarget).toEqual({
      targetFrameId: "root",
      tailSelector: selector,
      absPrefix: "",
    });
    expect(resolveFrame).not.toHaveBeenCalled();
  });

  it("queries semantic snapshot focus with the canonical matcher and nth", async () => {
    const steps: QueryStep[] = [{ kind: "text", text: "Save >> publish", exact: true }];
    const send = vi.fn(async () => ({ result: { objectId: "selected" } }));
    const session = { send } as unknown as CDPSessionLike;
    await expect(
      resolveObjectIdForCss(session, encodeLocatorQuery(steps), "root", 2, progress),
    ).resolves.toBe("selected");
    expect(send).toHaveBeenCalledExactlyOnceWith(
      "Runtime.evaluate",
      expect.objectContaining({
        expression: expect.stringContaining(
          `scripts["resolveSemanticSelector"](${JSON.stringify(steps)}, 2)`,
        ),
      }),
    );
  });

  it("releases failed query references and surfaces semantic errors", async () => {
    const details = { text: "Unsupported role state" };
    const send = vi.fn(async (method) =>
      method === "Runtime.evaluate"
        ? { result: { objectId: "error" }, exceptionDetails: details }
        : {},
    );
    const session = { send } as unknown as CDPSessionLike;
    await expect(
      resolveObjectIdForCss(
        session,
        encodeLocatorQuery([{ kind: "role", role: "button" }]),
        "root",
        0,
        progress,
      ),
    ).rejects.toMatchObject({
      message: details.text,
      cause: details,
    });
    expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", { objectId: "error" });
  });
});
