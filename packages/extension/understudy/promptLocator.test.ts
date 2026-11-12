import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
  LocatorChain,
} from "@browserbasehq/stagehand-protocol/types";
import {
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import { createStagehandRuntime } from "../runtime.js";
import {
  DecisionModelNotConfiguredError,
  InvalidPromptLocatorSelectionError,
  PromptLocatorRefusedError,
  UnsupportedPromptLocatorError,
} from "../errors.js";
import { Page } from "./page.js";
import type { Frame } from "./frame.js";
import { Progress } from "./progress.js";
import * as locatorChain from "./locatorChain.js";
import { resolvePromptLocator } from "./promptLocator.js";
import type { ApcCandidateOptions, ApcCandidateResult } from "./annotatedPageContent/candidates.js";
import { control } from "./annotatedPageContent/fixtures/controls.js";

const chain: LocatorChain = {
  steps: [{ type: "query", selector: { type: "prompt", value: "the resume file input" } }],
};
const progresses: Progress[] = [];
function budget(timeout = 0) {
  const progress = new Progress("locator", timeout);
  progresses.push(progress);
  return progress;
}
afterEach(() => {
  progresses.splice(0).forEach((progress) => progress.dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness() {
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({
    node: { localName: "section" },
  }));
  const frame = { frameId: "main", session: { send } } as unknown as Frame;
  const selectedFrame = { frameId: "child", session: {} } as Frame;
  const target = { id: "1-42", frame: selectedFrame, backendNodeId: 42 };
  const capture: ApcCandidateResult = {
    content: '[1-42] input_file [name="resume"]',
    candidates: [{ id: target.id, description: 'input_file [name="resume"]' }],
    targetsById: new Map([[target.id, target]]),
    unresolvedCount: 0,
    limitations: ["hidden-file-inputs"],
  };
  const query = vi.fn(async (_options?: ApcCandidateOptions, _progress?: Progress) => capture);
  const page = Object.assign(Object.create(Page.prototype) as Page, {
    mainFrame: () => frame,
    targetId: () => "page-1",
    queryAnnotatedPageContentCandidates: query,
  });
  const choose = vi.fn(
    async (_params: DecisionChooseParams, _progress: Progress): Promise<DecisionChooseResult> => ({
      status: "selected",
      id: target.id,
    }),
  );
  return { page, frame, send, target, capture, query, choose };
}

function runtimeFor(
  page: Page,
  choose: (params: DecisionChooseParams) => Promise<DecisionChooseResult>,
) {
  const runtime = createStagehandRuntime({ clientDecisionChoose: choose });
  runtime.state.setState(
    {
      status: "initialized",
      initParams: StagehandInitParamsSchema.parse({
        protocolVersion: STAGEHAND_PROTOCOL_VERSION,
        clientInfo: { name: "test", version: "1.0.0" },
        decisionModel: { source: "client" },
      }),
    },
    true,
  );
  runtime.pagesById.set("page-1", page);
  return runtime;
}

describe("prompt locator resolution", () => {
  it.each([
    ["click", "click"],
    ["sendClickEvent", "click"],
    ["fill", "fill"],
    ["type", "type"],
    ["selectOption", "select"],
    ["setInputFiles", "upload"],
    ["hover", "hover"],
    ["scrollTo", "scroll"],
  ] as const)(
    "prepares %s candidates and sends only %s selection evidence",
    async (operation, action) => {
      const h = harness();
      const progress = budget();
      const result = await resolvePromptLocator(h.page, chain, operation, h.choose, progress);
      expect(h.query).toHaveBeenCalledExactlyOnceWith({ operation }, progress);
      // A single candidate still requires the callback to decide whether it matches.
      expect(h.choose).toHaveBeenCalledExactlyOnceWith(
        { prompt: "the resume file input", action, candidates: h.capture.candidates },
        progress,
      );
      expect(result).toEqual({ frame: h.target.frame, backendNodeId: 42 });
      expect(result!.frame).toBe(h.target.frame);
      expect(h.send).not.toHaveBeenCalled();
    },
  );

  it.each(["section", "iframe", "frame"])(
    "turns a %s prefix into the correct APC scope",
    async (localName) => {
      const h = harness();
      const progress = budget();
      const target = { frame: h.frame, backendNodeId: 9 };
      const prefix: LocatorChain["steps"] = [
        { type: "query", selector: { type: "css", value: "iframe#checkout" }, nth: 1 },
        { type: "frame", selector: { type: "css", value: ".application" }, nth: 0 },
      ];
      const resolve = vi.spyOn(locatorChain, "resolveLocatorChain").mockResolvedValue([target]);
      h.send.mockResolvedValue({ node: { localName } });
      await resolvePromptLocator(
        h.page,
        { steps: [...prefix, chain.steps[0]!] },
        "setInputFiles",
        h.choose,
        progress,
      );
      expect(resolve).toHaveBeenCalledExactlyOnceWith(h.page, h.frame, { steps: prefix }, progress);
      expect(h.query).toHaveBeenCalledExactlyOnceWith(
        {
          operation: "setInputFiles",
          scopes: [{ type: localName === "section" ? "element" : "frame", target }],
        },
        progress,
      );
    },
  );

  it("skips capture and inference when the deterministic scope has no matches", async () => {
    const h = harness();
    vi.spyOn(locatorChain, "resolveLocatorChain").mockResolvedValue([]);
    const scoped: LocatorChain = {
      steps: [{ type: "query", selector: { type: "css", value: ".missing" } }, ...chain.steps],
    };
    await expect(
      resolvePromptLocator(h.page, scoped, "click", h.choose, budget()),
    ).resolves.toBeNull();
    expect(h.query).not.toHaveBeenCalled();
    expect(h.choose).not.toHaveBeenCalled();
  });

  it("does not call the model for an empty candidate set", async () => {
    const h = harness();
    h.query.mockResolvedValue({ ...h.capture, candidates: [] });
    await expect(
      resolvePromptLocator(h.page, chain, "click", h.choose, budget()),
    ).resolves.toBeNull();
    expect(h.choose).not.toHaveBeenCalled();
  });

  it("keeps no-match and refusal distinct and propagates provider errors without retry", async () => {
    const h = harness();
    h.choose.mockResolvedValueOnce({ status: "no_match" });
    await expect(
      resolvePromptLocator(h.page, chain, "click", h.choose, budget()),
    ).resolves.toBeNull();
    h.choose.mockResolvedValueOnce({ status: "refused" });
    await expect(
      resolvePromptLocator(h.page, chain, "click", h.choose, budget()),
    ).rejects.toBeInstanceOf(PromptLocatorRefusedError);
    const error = new Error("Provider unavailable");
    h.choose.mockRejectedValueOnce(error);
    await expect(resolvePromptLocator(h.page, chain, "click", h.choose, budget())).rejects.toBe(
      error,
    );
    expect(h.choose).toHaveBeenCalledTimes(3);
  });

  it("rejects IDs outside the candidate set even if they appear elsewhere in the capture", async () => {
    const h = harness();
    h.query.mockResolvedValue({
      ...h.capture,
      targetsById: new Map([
        ...h.capture.targetsById,
        ["0-99", { id: "0-99", frame: h.frame, backendNodeId: 99 }],
      ]),
    });
    h.choose.mockImplementation(async (params) => {
      params.candidates.push({ id: "0-99", description: "Injected choice" });
      return { status: "selected", id: "0-99" };
    });
    await expect(
      resolvePromptLocator(h.page, chain, "click", h.choose, budget()),
    ).rejects.toBeInstanceOf(InvalidPromptLocatorSelectionError);
    expect(h.capture.candidates).toHaveLength(1);
  });

  it("requires a captured target and preserves its identity while the callback runs", async () => {
    const h = harness();
    h.query.mockResolvedValueOnce({ ...h.capture, targetsById: new Map() });
    await expect(
      resolvePromptLocator(h.page, chain, "click", h.choose, budget()),
    ).rejects.toBeInstanceOf(InvalidPromptLocatorSelectionError);
    h.choose.mockImplementation(async () => {
      h.target.backendNodeId = 99;
      return { status: "selected", id: h.target.id };
    });
    await expect(resolvePromptLocator(h.page, chain, "click", h.choose, budget())).resolves.toEqual(
      { frame: h.target.frame, backendNodeId: 42 },
    );
  });

  it("rejects unsupported resolution shapes before capture or inference", async () => {
    const h = harness();
    const progress = budget();
    for (const invalid of [
      { steps: [...chain.steps, ...chain.steps] },
      { steps: [{ ...chain.steps[0]!, nth: 0 }] },
      { steps: [{ ...chain.steps[0]!, type: "frame" as const }] },
    ]) {
      await expect(
        resolvePromptLocator(h.page, invalid, "click", h.choose, progress),
      ).rejects.toBeInstanceOf(UnsupportedPromptLocatorError);
    }
    await expect(
      resolvePromptLocator(h.page, chain, "count", h.choose, progress),
    ).rejects.toBeInstanceOf(UnsupportedPromptLocatorError);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.choose).not.toHaveBeenCalled();
  });

  it("shares the deadline across capture and selection and discards late decisions", async () => {
    vi.useFakeTimers();
    const h = harness();
    const progress = budget(100);
    h.query.mockImplementation(async () => {
      await progress.delay(70);
      return h.capture;
    });
    const complete = Promise.withResolvers<DecisionChooseResult>();
    h.choose.mockImplementation(async (_, parent) => {
      expect(parent).toBe(progress);
      expect(parent.remainingMs()).toBe(30);
      return complete.promise;
    });
    const pending = resolvePromptLocator(h.page, chain, "click", h.choose, progress);
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    complete.resolve({ status: "selected", id: h.target.id });
    expect(h.query).toHaveBeenCalledOnce();
    expect(h.choose).toHaveBeenCalledOnce();
  });

  it("uses the shared APC capture and filtering for a real upload candidate request", async () => {
    const h = harness();
    Reflect.deleteProperty(h.page, "queryAnnotatedPageContentCandidates");
    h.page.getOrdinal = () => 0;
    const capture = vi.spyOn(h.page, "captureAnnotatedPageContent").mockResolvedValue({
      rootNode: {
        childrenNodes: [
          control("FORM_CONTROL_TYPE_INPUT_TEXT", "name", { commonAncestorDomNodeId: 10 }),
          control("FORM_CONTROL_TYPE_INPUT_FILE", "resume", { commonAncestorDomNodeId: 42 }),
          control("FORM_CONTROL_TYPE_INPUT_FILE", "disabled", {
            commonAncestorDomNodeId: 43,
            interactionInfo: { isDisabled: true },
          }),
        ],
      },
    });
    h.send.mockResolvedValue({
      node: { localName: "input", attributes: ["type", "file", "accept", ".pdf"] },
    });
    const choose = vi.fn(async (params: DecisionChooseParams): Promise<DecisionChooseResult> => ({
      status: "selected",
      id: params.candidates[0]!.id,
    }));
    const runtime = runtimeFor(h.page, choose);
    await expect(
      runtime.resolvePromptLocatorTarget(
        { pageId: "page-1", selector: chain },
        "setInputFiles",
        budget(),
      ),
    ).resolves.toEqual({ frame: h.frame, backendNodeId: 42 });
    expect(capture).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledExactlyOnceWith(
      {
        prompt: "the resume file input",
        action: "upload",
        candidates: [{ id: "0-42", description: expect.stringContaining('accept=".pdf"') }],
      },
      expect.any(AbortSignal),
    );
    expect(h.send).toHaveBeenCalledExactlyOnceWith("DOM.describeNode", { backendNodeId: 42 });
  });

  it("requires configuration and cannot send a capture to a replacement instance", async () => {
    const h = harness();
    const choose = vi.fn(async (): Promise<DecisionChooseResult> => ({ status: "no_match" }));
    const descriptor = { pageId: "page-1", selector: chain };
    const unconfigured = createStagehandRuntime();
    await expect(
      unconfigured.resolvePromptLocatorTarget(descriptor, "click", budget()),
    ).rejects.toBeInstanceOf(DecisionModelNotConfiguredError);
    const runtime = runtimeFor(h.page, choose);
    const started = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<ApcCandidateResult>();
    h.query.mockImplementation(async () => {
      started.resolve();
      return completion.promise;
    });
    const pending = runtime.resolvePromptLocatorTarget(descriptor, "click", budget());
    const rejected = expect(pending).rejects.toThrow("no longer active");
    await started.promise;
    await runtime.disposeStagehandInstance();
    completion.resolve(h.capture);
    await rejected;
    expect(choose).not.toHaveBeenCalled();
  });
});
