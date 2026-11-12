import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
  LocatorDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import {
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import { createStagehandRuntime } from "../runtime.js";
import { PromptLocatorNoMatchError, UnsupportedPromptLocatorError } from "../errors.js";
import { Page } from "../understudy/page.js";
import type { Frame } from "../understudy/frame.js";
import { ChainTargetLocator } from "../understudy/locatorChain.js";
import { Progress } from "../understudy/progress.js";
import { executionContexts } from "../understudy/executionContextRegistry.js";
import { fillElementValue } from "../dom/locatorScripts/scripts.js";
import { FrameSelectorResolver } from "../understudy/selectorResolver.js";
import * as actService from "../services/actService.js";
import * as extractService from "../services/extractService.js";
import * as observeService from "../services/observeService.js";
import type { ApcCandidateResult } from "../understudy/annotatedPageContent/candidates.js";

const descriptor: LocatorDescriptor = {
  pageId: "page-1",
  selector: {
    steps: [{ type: "query", selector: { type: "prompt", value: "the resume file input" } }],
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness() {
  const send = vi.fn(async (method: string, _params?: object): Promise<unknown> => {
    if (method === "DOM.resolveNode") return { object: { objectId: "chosen" } };
    if (method === "Runtime.callFunctionOn") return { result: { value: true } };
    return {};
  });
  const frame = { frameId: "child", session: { send } } as unknown as Frame;
  const target = { frame, backendNodeId: 42, id: "1-42" };
  const candidates: ApcCandidateResult = {
    content: "",
    candidates: [{ id: "1-42", description: "Resume" }],
    targetsById: new Map([["1-42", target]]),
    unresolvedCount: 0,
    limitations: [],
  };
  const capture = vi.fn(async () => candidates);
  const screenshot = vi.fn();
  const page = Object.assign(Object.create(Page.prototype) as Page, {
    queryAnnotatedPageContentCandidates: capture,
    screenshot,
  });
  const choose = vi.fn(
    async (_params: DecisionChooseParams, _signal: AbortSignal): Promise<DecisionChooseResult> => ({
      status: "selected",
      id: "1-42",
    }),
  );
  const runtime = createStagehandRuntime({ clientDecisionChoose: choose });
  runtime.state.setState(
    {
      status: "initialized",
      initParams: StagehandInitParamsSchema.parse({
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        clientInfo: { name: "test", version: "1" },
        decisionModel: { source: "client" },
      }),
    },
    true,
  );
  runtime.pagesById.set("page-1", page);
  return { runtime, page, capture, candidates, choose, frame, send, screenshot };
}

const options = { timeout: 5000, button: "right" as const, clickCount: 2 };
const cases = [
  {
    method: "click",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorClick({ ...descriptor, options }),
    args: [options],
    result: { clicked: true },
  },
  {
    method: "hover",
    run: (r: ReturnType<typeof createStagehandRuntime>) => r.locatorHover(descriptor),
    args: [],
    result: { hovered: true },
  },
  {
    method: "fill",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorFill({ ...descriptor, value: "name" }),
    args: ["name"],
    result: { filled: true },
  },
  {
    method: "type",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorType({ ...descriptor, text: "hello", options: { delay: 15 } }),
    args: ["hello", { delay: 15 }],
    result: { typed: true },
  },
  {
    method: "selectOption",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorSelectOption({ ...descriptor, values: ["a", "b"] }),
    args: [["a", "b"]],
    result: ["a", "b"],
  },
  {
    method: "scrollTo",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorScrollTo({ ...descriptor, percent: 75 }),
    args: [75],
    result: { scrolled: true },
  },
  {
    method: "sendClickEvent",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorSendClickEvent({ ...descriptor, options: { bubbles: false, detail: 2 } }),
    args: [{ bubbles: false, detail: 2 }],
    result: { clicked: true },
  },
  {
    method: "setInputFiles",
    run: (r: ReturnType<typeof createStagehandRuntime>) =>
      r.locatorSetInputFiles({
        ...descriptor,
        files: [
          { name: "resume.pdf", data: "AP9h", mimeType: "application/pdf", lastModified: 123 },
        ],
      }),
    args: [
      [
        {
          name: "resume.pdf",
          buffer: new Uint8Array([0, 255, 97]),
          mimeType: "application/pdf",
          lastModified: 123,
        },
      ],
    ],
    result: { set: true },
  },
] as const;

describe("prompt locator action delegation", () => {
  it.each(cases)(
    "delegates $method once with original arguments and the same progress",
    async ({ method, run, args, result }) => {
      const h = harness();
      const action = vi
        .spyOn(ChainTargetLocator.prototype, method)
        .mockResolvedValue(method === "selectOption" ? ["a", "b"] : undefined);
      await expect(run(h.runtime)).resolves.toEqual(result);
      expect(action).toHaveBeenCalledExactlyOnceWith(...args, expect.any(Progress));
      const progress = action.mock.calls[0]!.at(-1);
      expect(h.capture).toHaveBeenCalledExactlyOnceWith({ operation: method }, progress);
      expect(action.mock.instances[0]).toMatchObject({ frame: h.frame, backendId: 42 });
      expect(h.choose).toHaveBeenCalledTimes(1);
      expect(h.choose.mock.calls[0]![0]).not.toHaveProperty("files");
    },
  );

  it("clears files through the ordinary upload path", async () => {
    const h = harness();
    const action = vi.spyOn(ChainTargetLocator.prototype, "setInputFiles").mockResolvedValue();
    await h.runtime.locatorSetInputFiles({ ...descriptor, files: [] });
    expect(action).toHaveBeenCalledExactlyOnceWith([], expect.any(Progress));
  });

  it("reports no match and never dispatches or retries a failed action", async () => {
    const h = harness();
    const action = vi.spyOn(ChainTargetLocator.prototype, "click").mockResolvedValue();
    h.choose.mockResolvedValueOnce({ status: "no_match" });
    await expect(h.runtime.locatorClick(descriptor)).rejects.toBeInstanceOf(
      PromptLocatorNoMatchError,
    );
    expect(action).not.toHaveBeenCalled();
    const failure = new Error("Action failed after dispatch");
    action.mockRejectedValueOnce(failure);
    await expect(h.runtime.locatorClick(descriptor)).rejects.toBe(failure);
    expect(action).toHaveBeenCalledTimes(1);
    expect(h.choose).toHaveBeenCalledTimes(2);
  });

  it("uses only the selected backend node and rejects a detached target before dispatch", async () => {
    const h = harness();
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      kind: "extension",
      contextId: 7,
      capabilities: { closedShadowRoots: true },
    });
    const resolve = vi.spyOn(FrameSelectorResolver.prototype, "resolveAtIndex");
    // The first call checks attachment; a detached object may still have a CDP object ID.
    h.send.mockImplementation(async (method) =>
      method === "DOM.resolveNode"
        ? { object: { objectId: "detached" } }
        : { result: { value: false } },
    );
    await expect(h.runtime.locatorClick(descriptor)).rejects.toThrow("no longer attached");
    expect(resolve).not.toHaveBeenCalled();
    expect(h.send.mock.calls.map(([method]) => method)).toEqual([
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
      "Runtime.releaseObject",
    ]);
    expect(h.send).toHaveBeenCalledWith("DOM.resolveNode", {
      backendNodeId: 42,
      executionContextId: 7,
    });
    expect(h.choose).toHaveBeenCalledOnce();
  });

  it("executes the ordinary fill implementation against the captured node", async () => {
    const h = harness();
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      kind: "extension",
      contextId: 7,
      capabilities: { closedShadowRoots: true },
    });
    const query = vi.spyOn(FrameSelectorResolver.prototype, "resolveAtIndex");
    h.send.mockImplementation(async (method, params) => {
      if (method === "DOM.resolveNode") return { object: { objectId: "chosen" } };
      if (method === "Runtime.callFunctionOn") {
        const call = params as { functionDeclaration: string };
        return {
          result: {
            value:
              call.functionDeclaration === fillElementValue.toString() ? { status: "done" } : true,
          },
        };
      }
      return {};
    });
    await expect(h.runtime.locatorFill({ ...descriptor, value: "Ada" })).resolves.toEqual({
      filled: true,
    });
    expect(h.send).toHaveBeenCalledWith("DOM.resolveNode", {
      backendNodeId: 42,
      executionContextId: 7,
    });
    expect(h.send).toHaveBeenCalledWith(
      "Runtime.callFunctionOn",
      expect.objectContaining({
        objectId: "chosen",
        functionDeclaration: fillElementValue.toString(),
        arguments: [{ value: "Ada" }],
      }),
    );
    expect(h.send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "chosen" });
    expect(query).not.toHaveBeenCalled();
    expect(h.choose).toHaveBeenCalledOnce();
  });

  it("releases the captured handle when attachment verification times out", async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      kind: "extension",
      contextId: 7,
      capabilities: { closedShadowRoots: true },
    });
    const completion = Promise.withResolvers<unknown>();
    h.send.mockImplementation(async (method) => {
      if (method === "DOM.resolveNode") return { object: { objectId: "chosen" } };
      if (method === "Runtime.callFunctionOn") return completion.promise;
      return {};
    });
    const failed = expect(
      h.runtime.locatorClick({ ...descriptor, options: { timeout: 10 } }),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(11);
    await failed;
    completion.resolve({ result: { value: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "chosen" });
    expect(h.send.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false);
  });

  it("stops capture and disposal promptly even with an unlimited timeout", async () => {
    const h = harness();
    const started = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<ApcCandidateResult>();
    h.capture.mockImplementation(async () => {
      started.resolve();
      return completion.promise;
    });
    const release = h.runtime.acquireStagehandInstanceRequest();
    const action = vi.spyOn(ChainTargetLocator.prototype, "click");
    const pending = h.runtime
      .locatorClick({ ...descriptor, options: { timeout: 0 } })
      .finally(release);
    const failed = expect(pending).rejects.toThrow("no longer active");
    await started.promise;
    await h.runtime.disposeStagehandInstance();
    await failed;
    completion.resolve(h.candidates);
    await Promise.resolve();
    expect(h.choose).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it("stops further action steps when the instance is disposed", async () => {
    const h = harness();
    const started = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<void>();
    const continued = vi.fn();
    vi.spyOn(ChainTargetLocator.prototype, "click").mockImplementation(
      async (_options, progress) => {
        started.resolve();
        await progress!.run("preparing click", () => completion.promise);
        continued();
      },
    );
    const release = h.runtime.acquireStagehandInstanceRequest();
    const pending = h.runtime
      .locatorClick({ ...descriptor, options: { timeout: 0 } })
      .finally(release);
    const failed = expect(pending).rejects.toThrow("no longer active");
    await started.promise;
    await h.runtime.disposeStagehandInstance();
    await failed;
    completion.resolve();
    await Promise.resolve();
    expect(continued).not.toHaveBeenCalled();
  });

  it("keeps selection and action under one deadline", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.choose.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return { status: "selected", id: "1-42" };
    });
    const action = vi
      .spyOn(ChainTargetLocator.prototype, "type")
      .mockImplementation(async (_text, _options, progress) => {
        expect(progress!.remainingMs()).toBe(30);
        await progress!.delay(40);
        throw new Error("Must not continue after timeout");
      });
    const failed = expect(
      h.runtime.locatorType({ ...descriptor, text: "hello", options: { timeout: 100, delay: 20 } }),
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(101);
    await failed;
    expect(action).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "locatorCount",
    "locatorIsChecked",
    "locatorInputValue",
    "locatorIsVisible",
    "locatorInnerText",
    "locatorInnerHtml",
    "locatorTextContent",
    "locatorCentroid",
    "locatorHighlight",
  ] as const)("rejects %s before inference", async (method) => {
    const h = harness();
    await expect(h.runtime[method](descriptor)).rejects.toBeInstanceOf(
      UnsupportedPromptLocatorError,
    );
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.choose).not.toHaveBeenCalled();
  });

  it.each([
    {
      steps: [
        ...descriptor.selector.steps,
        { type: "query" as const, selector: { type: "css" as const, value: "button" } },
      ],
    },
    { steps: [{ ...descriptor.selector.steps[0]!, nth: 0 }] },
  ])("rejects deferred chain combinations before inference", async (selector) => {
    const h = harness();
    await expect(h.runtime.locatorClick({ ...descriptor, selector })).rejects.toBeInstanceOf(
      UnsupportedPromptLocatorError,
    );
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.choose).not.toHaveBeenCalled();
  });

  it("rejects prompt screenshot masks before capture", async () => {
    const h = harness();
    await expect(
      h.runtime.pageScreenshot({ pageId: "page-1", options: { mask: [descriptor] } }),
    ).rejects.toThrow("screenshot masks");
    expect(h.screenshot).not.toHaveBeenCalled();
    expect(h.choose).not.toHaveBeenCalled();
  });

  it.each(["locator", "ignoreLocators"] as const)(
    "rejects prompt %s in generation services before any work",
    async (field) => {
      const options = {
        [field]:
          field === "locator"
            ? { selector: descriptor.selector }
            : [{ selector: descriptor.selector }],
      };
      for (const service of [actService.act, observeService.observe, extractService.extract]) {
        // Only params are needed: the guard must run before accessing the page or generator.
        await expect(
          service({ params: { pageId: "page-1", instruction: "test", options } } as never),
        ).rejects.toBeInstanceOf(UnsupportedPromptLocatorError);
      }
    },
  );
});
