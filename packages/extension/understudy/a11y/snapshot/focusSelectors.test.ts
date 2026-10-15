import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { Progress } from "../../progress.js";
import {
  resolveCssFocusFrameAndTail,
  resolveObjectIdForCss,
  resolveObjectIdForXPath,
} from "./focusSelectors.js";
import {
  decodeLocatorQuery,
  encodeLocatorQuery,
  type QueryStep,
} from "../../../types/private/semanticLocator.js";
import type { Frame } from "../../frame.js";
import type { Page } from "../../page.js";
import { FrameLocator } from "../../frameLocator.js";
import { resolveLocatorTarget } from "../../deepLocator.js";

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
    ["/html/body/iframe[1]/html/body/section", "/html/body/iframe[1]"],
    [
      "/html/body/iframe[1]/html/iframe[2]/html/body/section",
      "/html/body/iframe[1]/html/iframe[2]",
    ],
  ])("retains the canonical frame prefix for semantic XPath scope %s", async (xpath, prefix) => {
    const frame = { frameId: "root" } as Frame;
    const child = { frameId: "child" } as Frame;
    const page = { frameForId: () => frame } as unknown as Page;
    const resolveFrame = vi.spyOn(FrameLocator.prototype, "resolveFrame").mockResolvedValue(child);
    const steps: QueryStep[] = [
      { kind: "selector", selector: `xpath=${xpath}` },
      { kind: "role", role: "button", options: { name: "Save >> publish" } },
    ];
    const result = await resolveCssFocusFrameAndTail(
      page,
      encodeLocatorQuery(steps),
      new Map([
        ["root", null],
        ["child", "root"],
      ]),
      "root",
      progress,
    );
    expect(result).toMatchObject({ targetFrameId: "child", absPrefix: prefix });
    expect(decodeLocatorQuery(result.tailSelector)).toEqual([
      { kind: "selector", selector: "xpath=/html/body/section" },
      steps[1],
    ]);
    expect(resolveFrame).toHaveBeenCalledExactlyOnceWith(progress);
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
