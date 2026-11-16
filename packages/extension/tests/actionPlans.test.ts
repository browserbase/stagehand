import { Progress } from "../understudy/progress.js";
import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionNodes,
  buildPlans,
  choosePlan,
  type ActionSnapshot,
} from "../services/decisions/actionPlans.js";
import { runDecisionsAct, type DecisionsActDeps } from "../services/decisions/act.js";
import { StagehandLogger } from "../logger.js";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import type { ElementFacts } from "../services/decisions/actionFacts.js";

vi.mock("../understudy/deepLocator.js", () => ({ resolveLocatorWithHops: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function facts(overrides: Partial<ElementFacts> = {}): ElementFacts {
  return {
    visible: true,
    enabled: true,
    editable: false,
    readonly: false,
    tag: "a",
    type: "",
    name: "",
    text: "Open",
    context: "",
    ...overrides,
  };
}
function snapshot(): ActionSnapshot {
  return {
    formattedTree: "[0-1] RootWebArea: Directory\n  [0-2] link: Open\n  [0-3] textbox: Search",
    xpathMap: { "0-2": "/html/body/a", "0-3": "/html/body/input" },
    urlMap: {},
    url: "https://example.org/",
    editableIds: ["0-3"],
    facts: {
      "0-2": facts({ href: "https://example.org/details" }),
      "0-3": facts({ tag: "input", editable: true, text: "", value: "" }),
    },
  };
}

function editorSnapshot(): ActionSnapshot {
  return {
    formattedTree:
      "[0-1] RootWebArea\n  [0-2] body\n    [0-5] heading: Editor\n    [0-8] StaticText: old text",
    xpathMap: {
      "0-1": "/",
      "0-2": "/html/body",
      "0-5": "/html/body/h1",
      "0-7": "/html/body/div",
      "0-8": "/html/body/div/text()[1]",
    },
    facts: {
      "0-7": facts({
        tag: "div",
        editable: true,
        editableRoot: true,
        name: "Message editor",
        text: "old text",
      }),
    },
    editableIds: [],
    urlMap: {},
    url: "https://example.org/",
  };
}
function provider(selected: string, confidence = 0.98) {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const options = Object.keys(body.questions.action.criteria);
    return Response.json({
      model: "jev-1.14.0",
      answers: {
        action: {
          type: "choice",
          choice: selected,
          confidence,
          probabilities: Object.fromEntries(
            options.map((id) => [
              id,
              id === selected ? confidence : (1 - confidence) / (options.length - 1),
            ]),
          ),
        },
      },
      usage: { input_tokens: 100, output_tokens: 1 },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const config = { provider: "typesafe", apiKey: "test" } as const;

describe("complete action choices", () => {
  it("recovers an AX-omitted editable root with its actual label, position and descendants", () => {
    const page = editorSnapshot();
    const nodes = actionNodes(page);
    expect(nodes.map((node) => node.id)).toEqual(["0-1", "0-2", "0-5", "0-7", "0-8"]);
    expect(nodes[4]!.parent).toBe(3);
    expect(buildPlans(page, 'Fill Message editor with "fresh evidence"')).toEqual([
      expect.objectContaining({
        nodeId: "0-7",
        method: "fill",
        arguments: ["fresh evidence"],
        evidence: expect.objectContaining({ name: "Message editor", heading: "Editor" }),
      }),
    ]);
  });
  it("does not recover an editor outside the locator-scoped outline", () => {
    const page = editorSnapshot();
    page.formattedTree = "[0-5] heading: Editor";
    expect(buildPlans(page, 'Fill Message editor with "hello"')).toEqual([]);
  });

  it("recovers an omitted editor inside the scoped root", () => {
    const page = editorSnapshot();
    page.formattedTree = "[0-2] body\n  [0-8] StaticText: old text";
    expect(buildPlans(page, 'Fill Message editor with "hello"')).toEqual([
      expect.objectContaining({ nodeId: "0-7", method: "fill" }),
    ]);
  });
  it("enumerates complete literal actions and preserves link destinations", () => {
    const plans = buildPlans(snapshot(), 'Fill Search with "hello"');
    expect(plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "click",
          nodeId: "0-2",
          evidence: expect.objectContaining({ destination: "https://example.org/details" }),
        }),
        expect.objectContaining({ method: "fill", nodeId: "0-3", arguments: ["hello"] }),
      ]),
    );
    expect(
      buildPlans(snapshot(), "Fill Search with a suitable greeting").some(
        (plan) => plan.method === "fill",
      ),
    ).toBe(false);
  });

  it("offers an editor's root rather than its editable paragraphs", () => {
    const page = editorSnapshot();
    page.formattedTree = page.formattedTree.replace("StaticText: old text", "paragraph");
    page.xpathMap["0-8"] = "/html/body/div/p";
    page.editableIds = ["0-8"];
    page.facts["0-8"] = facts({ tag: "p", editable: true, editableRoot: false });
    expect(buildPlans(page, 'Fill Message editor with "hello"').map((plan) => plan.nodeId)).toEqual(
      ["0-7"],
    );
  });

  it("keeps a recovered main-frame editor after a preceding iframe's subtree", () => {
    const page = editorSnapshot();
    page.formattedTree =
      "[0-1] RootWebArea\n  [0-2] body\n    [0-6] iframe\n      [1-1] RootWebArea\n        [1-2] heading: Frame contents\n    [0-8] StaticText: old text";
    page.xpathMap = {
      "0-1": "/",
      "0-2": "/html/body",
      "0-6": "/html/body/iframe",
      "0-7": "/html/body/div",
      "0-8": "/html/body/div/text()[1]",
      "1-1": "/html/body/iframe/html",
      "1-2": "/html/body/iframe/html/body/h1",
    };
    expect(actionNodes(page).map((node) => node.id)).toEqual([
      "0-1",
      "0-2",
      "0-6",
      "1-1",
      "1-2",
      "0-7",
      "0-8",
    ]);
  });

  it("excludes hidden, disabled, readonly and unknown inputs", () => {
    for (const overrides of [{ visible: false }, { enabled: false }, { readonly: true }]) {
      const page = snapshot();
      page.facts["0-3"] = facts({ editable: true, ...overrides });
      expect(
        buildPlans(page, 'Fill Search with "hello"').some((plan) => plan.nodeId === "0-3"),
      ).toBe(false);
    }
    const page = snapshot();
    delete page.facts["0-3"];
    expect(buildPlans(page, 'Fill Search with "hello"').some((plan) => plan.nodeId === "0-3")).toBe(
      false,
    );
  });

  it("keeps abstention explicit even for one actionable target", async () => {
    const fetch = provider("none_match");
    const result = await choosePlan(config, snapshot(), "Open the missing editor");
    expect(result.plan).toBeUndefined();
    const body = JSON.parse(fetch.mock.calls[0]![1].body as string);
    expect(Object.keys(body.questions)).toEqual(["action"]);
    expect(body.questions.action.criteria).toHaveProperty("none_match");
  });

  it("escalates oversized action sets instead of silently truncating literal arguments", () => {
    const instruction = Array.from({ length: 260 }, (_, index) => `"literal ${index}"`).join(" ");
    expect(buildPlans(snapshot(), instruction)).toEqual([]);
  });

  it("redacts variable values in every model input while preserving placeholders for execution", async () => {
    const page = snapshot();
    page.facts["0-3"]!.context = "A secret-value appears in the page";
    const fetch = provider("none_match");
    await choosePlan(config, page, "Fill Search with %token%", {
      variables: { token: "secret-value" },
    });
    const body = fetch.mock.calls[0]![1].body as string;
    expect(body).not.toContain("secret-value");
    expect(body).toContain("%token%");
    expect(
      buildPlans(page, "Fill Search with %token%", { variables: { token: "secret-value" } }).find(
        (plan) => plan.method === "fill",
      )?.arguments,
    ).toEqual(["%token%"]);
  });
});

function dependencies(page = snapshot()) {
  const takeAction = vi.fn(async (action) => ({
    success: true,
    message: "Done",
    actionDescription: action.description,
    actions: [action],
  }));
  const evaluate = vi.fn(async (_fn, paths: Record<string, string>) =>
    Object.fromEntries(
      Object.keys(paths)
        .filter((id) => page.facts[id])
        .map((id) => [id, page.facts[id]]),
    ),
  );
  const backendNodeId = vi.fn(async () => 2);
  const session = {
    send: vi.fn(async (method: string) => {
      if (method === "DOM.describeNode") return { node: { backendNodeId: await backendNodeId() } };
      return method === "Runtime.callFunctionOn" ? { result: { value: { verdict: "ok" } } } : {};
    }),
  };
  const locator = {
    backendNodeId,
    getFrame: () => ({ session }),
    resolveNode: async () => ({ objectId: "target" }),
    inputValue: async () => "hello",
  };
  vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator as never);
  const deps = {
    page: {
      captureSnapshot: async () => ({
        combinedTree: page.formattedTree,
        combinedXpathMap: page.xpathMap,
        combinedUrlMap: {},
        combinedEditableIds: page.editableIds,
      }),
      evaluate,
      mainFrame: () => ({}),
      getOrdinal: () => 0,
      url: () => page.url,
    },
    instruction: "Open details",
    snapshotOptions: {},
    logger: new StagehandLogger(
      { tracer: trace.getTracer("action-plans-test") },
      () => {},
      undefined,
      "off",
    ),
    progress: new Progress("action-test", 0),
    takeAction,
  } as unknown as DecisionsActDeps;
  return { deps, takeAction, evaluate, locator };
}

describe("action execution guards", () => {
  it("executes a recovered editor using the DOM element's backend identity", async () => {
    provider("action_0");
    const { deps, locator, takeAction } = dependencies(editorSnapshot());
    deps.instruction = 'Fill Message editor with "hello"';
    locator.backendNodeId.mockResolvedValue(7);
    expect(await runDecisionsAct(config, deps)).toMatchObject({ kind: "done" });
    expect(takeAction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ selector: "xpath=/html/body/div", method: "fill" }),
      "0-7",
    );
  });
  it("rejects a replacement at the same xpath before any side effect", async () => {
    provider("action_0");
    const { deps, takeAction, locator } = dependencies();
    locator.backendNodeId.mockResolvedValue(99);
    const result = await runDecisionsAct(config, deps);
    expect(result).toMatchObject({
      kind: "fallback",
      reason: "action_plan_target_changed:other_node",
    });
    expect(takeAction).not.toHaveBeenCalled();
  });

  it("rejects changed link evidence even when the backend node survives", async () => {
    provider("action_0");
    const { deps, takeAction, evaluate } = dependencies();
    evaluate
      .mockResolvedValueOnce(snapshot().facts)
      .mockResolvedValueOnce({ "0-2": facts({ href: "https://example.org/delete" }) });
    expect(await runDecisionsAct(config, deps)).toMatchObject({
      kind: "fallback",
      reason: "action_plan_evidence_changed",
    });
    expect(takeAction).not.toHaveBeenCalled();
  });

  it.each(["renamed target", "changed heading", "new duplicate target"])(
    "rejects changed AX evidence before input: %s",
    async (mutation) => {
      provider("action_0");
      const page = snapshot();
      page.formattedTree =
        "[0-1] RootWebArea: Directory\n  [0-4] heading: Reading\n  [0-2] link: Open";
      const { deps, takeAction } = dependencies(page);
      const original = await deps.page.captureSnapshot({}, deps.progress);
      const combinedTree =
        mutation === "renamed target"
          ? original.combinedTree.replace("link: Open", "link: Delete")
          : mutation === "changed heading"
            ? original.combinedTree.replace("heading: Reading", "heading: Danger")
            : `${original.combinedTree}\n  [0-5] link: Open`;
      deps.page.captureSnapshot = vi
        .fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce({ ...original, combinedTree });
      expect(await runDecisionsAct(config, deps)).toMatchObject({
        kind: "fallback",
        reason: "action_plan_evidence_changed",
      });
      expect(takeAction).not.toHaveBeenCalled();
    },
  );

  it("executes a checked complete action exactly once", async () => {
    provider("action_0");
    const { deps, takeAction } = dependencies();
    expect(await runDecisionsAct(config, deps)).toMatchObject({ kind: "done" });
    expect(takeAction).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ selector: "xpath=/html/body/a", method: "click", arguments: [] }),
      "0-2",
    );
  });

  it("returns a performed fill failure without executing LLM fallback", async () => {
    provider("action_1");
    const { deps, takeAction, locator } = dependencies();
    deps.instruction = 'Fill Search with "hello"';
    locator.backendNodeId.mockResolvedValue(3);
    locator.inputValue = async () => "wrong value";
    const outcome = await runDecisionsAct(config, deps);
    expect(outcome).toMatchObject({
      kind: "done",
      noCache: true,
      result: {
        success: false,
        message: "fill_readback_mismatch",
        actions: [expect.objectContaining({ method: "fill", arguments: ["hello"] })],
      },
    });
    expect(takeAction).toHaveBeenCalledTimes(1);
  });
});
