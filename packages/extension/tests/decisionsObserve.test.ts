import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { Progress } from "../understudy/progress.js";
import { selectObservation } from "../services/decisions/observeSelection.js";
import { runDecisionsObserve } from "../services/decisions/observe.js";
import type { ObservationSnapshot } from "../services/decisions/observeCandidates.js";
import {
  fakeDecisionProvider,
  type ScriptedAnswer,
  type WireQuestion,
} from "./decisionsTestUtils.js";
import { observe } from "../services/observeService.js";
import { ObserveResultSchema } from "@browserbasehq/stagehand-protocol/schemas";

afterEach(() => vi.unstubAllGlobals());
const logger = () =>
  new StagehandLogger({ tracer: trace.getTracer("observe-decisions-test") }, () => {});
function snapshot(count = 1): ObservationSnapshot {
  const ids = Array.from({ length: count }, (_, i) => `0-${i + 12}`);
  return {
    formattedTree:
      "[0-1] RootWebArea: Contact\n" +
      ids.map((id, i) => `  [${id}] textbox: Field ${i + 1}`).join("\n"),
    xpathMap: Object.fromEntries(ids.map((id, i) => [id, `/html/body/input[${i + 1}]`])),
    urlMap: {},
    editableIds: ids,
    url: "https://contact.test/",
    facts: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          visible: true,
          enabled: true,
          editable: true,
          readonly: false,
          tag: "input",
          type: "text",
          name: "",
          text: "",
          context: "",
        },
      ]),
    ),
  };
}
function serve(
  provider: "typesafe" | "cloudflare" | "perplexity" = "perplexity",
  overrides: (key: string, q: WireQuestion) => ScriptedAnswer | undefined = () => undefined,
) {
  return fakeDecisionProvider(
    provider,
    (key, q) =>
      overrides(key, q) ??
      (key === "cardinality"
        ? { choice: "one", p: 0.99 }
        : key === "operation"
          ? { choice: "default", p: 0.99 }
          : key === "kind"
            ? { choice: "supported", p: 0.99 }
            : key === "target_type"
              ? { choice: "any", p: 0.99 }
              : key === "target"
                ? { choice: q.options.find((id) => id !== "none_match"), p: 0.99 }
                : { p: 0.99 }),
    (mock) => vi.stubGlobal("fetch", vi.fn(mock)),
  );
}
const config = () => ({
  provider: "perplexity" as const,
  apiKey: `test-${Math.random()}`,
  model: "pplx-decider-v1.3",
});
function page(snap: ObservationSnapshot, after = snap) {
  let captures = 0;
  let current = snap;
  return {
    captureSnapshot: vi.fn(async () => {
      current = captures++ ? after : snap;
      return {
        combinedTree: current.formattedTree,
        combinedXpathMap: current.xpathMap,
        combinedUrlMap: current.urlMap,
        combinedEditableIds: current.editableIds,
      };
    }),
    evaluate: vi.fn(async () => current.facts),
    url: () => snap.url,
  };
}

describe("decision observations", () => {
  it("includes native file controls even when their AX role is not button", async () => {
    const snap = snapshot();
    snap.formattedTree = snap.formattedTree.replace("textbox: Field 1", "input, file: Upload file");
    snap.facts["0-12"]!.type = "file";
    snap.facts["0-12"]!.editable = false;
    serve();
    expect(await selectObservation(config(), snap, "Find the file upload control")).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/input[1]", method: "click" }],
    });
  });
  it("keeps explicit blank instructions on the ordinary path", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await selectObservation(config(), snapshot(), "  ")).toMatchObject({
      kind: "fallback",
      reason: "empty_instruction",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["typesafe", "cloudflare", "perplexity"] as const)(
    "resolves bounded observations through %s",
    async (provider) => {
      serve(provider);
      expect(
        await selectObservation(
          { ...config(), provider, ...(provider === "cloudflare" ? { accountId: "account" } : {}) },
          snapshot(),
          "Find Field 1",
        ),
      ).toMatchObject({
        kind: "done",
        actions: [{ selector: "xpath=/html/body/input[1]", method: "fill", arguments: [] }],
      });
    },
  );
  it("accounts for every member, including matches beyond position thirty", async () => {
    const seen = serve("perplexity", (key) =>
      key === "cardinality" ? { choice: "all", p: 0.99 } : undefined,
    );
    const result = await selectObservation(config(), snapshot(80), "Find all fields");
    expect(result.kind === "done" && result.actions).toHaveLength(80);
    expect(JSON.stringify(seen)).toContain("match_0-91");
    expect(seen).toHaveLength(2);
  });
  it("does not score set membership for single-target requests", async () => {
    const seen = serve();
    const result = await selectObservation(config(), snapshot(80), "Find Field 1");
    expect(result.kind).toBe("done");
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen).match(/A similar control or a wrapper/g)).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("match_0-91");
  });
  it("keeps candidates beyond the old 254 element limit", async () => {
    const seen = serve("perplexity", (key, question) => {
      if (key === "target")
        return question.options.includes("0-311")
          ? { choice: "0-311", p: 0.99 }
          : { choice: "none_match", p: 0.99 };
      if (key === "exists") {
        const candidates = JSON.parse(question.text).candidates;
        return { p: "0-311" in candidates ? 0.99 : 0.01 };
      }
      return undefined;
    });
    expect(await selectObservation(config(), snapshot(300), "Find Field 300")).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/input[300]" }],
    });
    expect(seen).toHaveLength(4);
  });
  it("does not accept an empty shard with contradictory existence evidence", async () => {
    serve("perplexity", (key) =>
      key === "target" ? { choice: "none_match", p: 0.99 } : undefined,
    );
    expect(await selectObservation(config(), snapshot(300), "Find Country")).toMatchObject({
      kind: "fallback",
      reason: "target_uncertain",
    });
  });
  it("compares competing shard winners before returning one target", async () => {
    const seen = serve("perplexity", (key, question) =>
      key === "target" ? { choice: question.options[0], p: 0.99 } : undefined,
    );
    const result = await selectObservation(config(), snapshot(300), "Find the best matching field");
    expect(result.kind === "done" && result.actions).toHaveLength(1);
    expect(seen).toHaveLength(5);
    expect(Object.keys(seen[4]!.body.questions as object)).toEqual(["target"]);
  });
  it("reads iframe evidence in the owning frame with local paths", async () => {
    serve();
    const snap = snapshot();
    snap.formattedTree = snap.formattedTree.replaceAll("0-", "1-");
    snap.xpathMap = { "1-12": "/html/body/iframe[1]/html/body/input[1]" };
    snap.facts = { "1-12": snapshot().facts["0-12"]! };
    const browser = page(snap);
    const evaluate = vi.fn(async () => snap.facts);
    browser.captureSnapshot.mockImplementation(async () => ({
      combinedTree: snap.formattedTree,
      combinedXpathMap: snap.xpathMap,
      combinedUrlMap: {},
      combinedEditableIds: [],
      perFrame: [
        {
          frameId: "child",
          outline: snap.formattedTree,
          xpathMap: { "1-12": "/html/body/input[1]" },
          urlMap: {},
        },
      ],
    }));
    const frameForId = vi.fn(() => ({ evaluate }));
    expect(
      await runDecisionsObserve(config(), {
        page: { ...browser, frameForId } as never,
        logger: logger(),
        instruction: "Find Field 1",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/iframe[1]/html/body/input[1]" }],
    });
    expect(frameForId).toHaveBeenCalledWith("child");
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), { "1-12": "/html/body/input[1]" });
    expect(browser.evaluate).not.toHaveBeenCalled();
  });
  it("applies the budget to the requested kind without truncating that kind", async () => {
    const snap = snapshot(650);
    snap.formattedTree = snap.formattedTree.replace("textbox: Field 1", "button: Submit");
    snap.facts["0-12"]!.tag = "button";
    snap.facts["0-12"]!.editable = false;
    serve("perplexity", (key) =>
      key === "target_type" ? { choice: "button", p: 0.99 } : undefined,
    );
    expect(await selectObservation(config(), snap, "Find the Submit button")).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/input[1]", method: "click" }],
    });
  });
  it("accounts for all set members across batches", async () => {
    serve("perplexity", (key) => (key === "cardinality" ? { choice: "all", p: 0.99 } : undefined));
    const result = await selectObservation(config(), snapshot(300), "Find all fields");
    expect(result.kind === "done" && result.actions).toHaveLength(300);
  });
  it("does not use a rejected literal-label shortlist to prove absence", async () => {
    serve("perplexity", (key) =>
      key === "target"
        ? { choice: "none_match", p: 0.99 }
        : key === "exists"
          ? { p: 0.01 }
          : undefined,
    );
    expect(
      await selectObservation(config(), snapshot(), 'Find "Field 1" in the billing section'),
    ).toMatchObject({
      kind: "fallback",
      reason: "quoted_target_uncertain",
    });
  });
  it("reads outline and editable side-channel facts without scanning hidden DOM entries", async () => {
    serve();
    const snap = snapshot();
    snap.xpathMap["0-800"] = "/html/body/div[1]";
    snap.xpathMap["0-900"] = "/html/body/div[2]";
    snap.editableIds.push("0-900");
    const browser = page(snap);
    expect(
      await runDecisionsObserve(config(), {
        page: browser as never,
        logger: logger(),
        instruction: "Find Field 1",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "done" });
    expect(browser.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      "0-12": "/html/body/input[1]",
      "0-900": "/html/body/div[2]",
    });
  });
  it("still falls back when a failed frame read leaves controls unrepresented", async () => {
    serve();
    const snap = snapshot();
    const browser = page(snap);
    browser.captureSnapshot.mockImplementation(async () => ({
      combinedTree: snap.formattedTree,
      combinedXpathMap: snap.xpathMap,
      combinedUrlMap: {},
      combinedEditableIds: [],
      perFrame: [
        { frameId: "child", outline: snap.formattedTree, xpathMap: snap.xpathMap, urlMap: {} },
      ],
    }));
    expect(
      await runDecisionsObserve(config(), {
        page: {
          ...browser,
          frameForId: () => ({
            evaluate: async () => {
              throw new Error("detached");
            },
          }),
        } as never,
        logger: logger(),
        instruction: "Find Field 1",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "unrepresented_candidates:1" });
  });
  it("checks the broad view before accepting absence from a role-specific view", async () => {
    const snap = snapshot(2);
    snap.formattedTree = snap.formattedTree.replace("textbox: Field 1", "button: Submit");
    snap.facts["0-12"]!.tag = "button";
    snap.facts["0-12"]!.editable = false;
    const seen = serve("perplexity", (key) =>
      key === "target_type"
        ? { choice: "button", p: 0.99 }
        : key === "target"
          ? { choice: "none_match", p: 0.99 }
          : key === "exists"
            ? { p: 0.01 }
            : undefined,
    );
    expect(await selectObservation(config(), snap, "Find the Refund payment button")).toEqual({
      kind: "done",
      actions: [],
    });
    expect(seen).toHaveLength(3);
    expect(JSON.stringify(seen[2]!.body)).toContain("Field 2");
  });
  it("returns unsupported intent before reading DOM facts", async () => {
    serve("perplexity", (key) =>
      key === "operation" ? { choice: "unsupported", p: 0.99 } : undefined,
    );
    const browser = page(snapshot());
    expect(
      await runDecisionsObserve(config(), {
        page: browser as never,
        logger: logger(),
        instruction: "Drag Field 1",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "unsupported_observation" });
    expect(browser.evaluate).not.toHaveBeenCalled();
  });
  it("escalates oversized hosted Clef Flash input before selection can be truncated", async () => {
    const seen = serve("cloudflare");
    expect(
      await selectObservation(
        { ...config(), provider: "cloudflare", accountId: "account", model: "clef-flash" },
        snapshot(80),
        "Find all fields",
      ),
    ).toMatchObject({ kind: "fallback", reason: "provider_context_budget" });
    expect(seen).toHaveLength(1);
  });
  it("escalates the whole set if one member is uncertain", async () => {
    serve("perplexity", (key) =>
      key === "cardinality"
        ? { choice: "all", p: 0.99 }
        : key === "match_0-13"
          ? { p: 0.5 }
          : key.startsWith("verify_")
            ? { choice: "none_match", p: 0.5 }
            : undefined,
    );
    expect(await selectObservation(config(), snapshot(2), "Find all fields")).toMatchObject({
      kind: "fallback",
      reason: "uncertain_set_member",
    });
  });
  it.each([
    { choice: "match", count: 2 },
    { choice: "none_match", count: 1 },
  ])("resolves an uncertain set member with a verified $choice", async ({ choice, count }) => {
    serve("perplexity", (key) =>
      key === "cardinality"
        ? { choice: "all", p: 0.99 }
        : key === "match_0-13"
          ? { p: 0.5 }
          : key === "verify_0-13"
            ? { choice, p: 0.9 }
            : undefined,
    );
    const result = await selectObservation(config(), snapshot(2), "Find all fields");
    expect(result.kind).toBe("done");
    expect(result.kind === "done" && result.actions).toHaveLength(count);
  });
  it("distinguishes a certified empty choice from a contradictory existence answer", async () => {
    serve("perplexity", (key) =>
      key === "target"
        ? { choice: "none_match", p: 0.99 }
        : key === "exists"
          ? { p: 0.01 }
          : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Find Country")).toMatchObject({
      kind: "done",
      actions: [],
    });
    serve("perplexity", (key) =>
      key === "target" ? { choice: "none_match", p: 0.99 } : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Find Country")).toMatchObject({
      kind: "fallback",
    });
  });
  it("requires a confident absence choice before accepting an empty result", async () => {
    serve("perplexity", (key) =>
      key === "target"
        ? { choice: "none_match", p: 0.6 }
        : key === "exists"
          ? { p: 0.01 }
          : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Find Country")).toMatchObject({
      kind: "fallback",
      reason: "target_uncertain",
    });
  });
  it.each([
    { member: 0.01, exists: 0.99 },
    { member: 0.99, exists: 0.01 },
  ])("rejects contradictory set existence: %j", async ({ member, exists }) => {
    serve("perplexity", (key) =>
      key === "cardinality"
        ? { choice: "all", p: 0.99 }
        : key === "exists"
          ? { p: exists }
          : key.startsWith("match_")
            ? { p: member }
            : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Find all fields")).toMatchObject({
      kind: "fallback",
      reason: "set_existence_disagrees",
    });
  });
  it("includes sibling labels and occurrence numbers in candidate evidence", async () => {
    const snap = snapshot(2);
    snap.formattedTree = `[0-1] RootWebArea: Contact
  [0-2] LabelText: Personal address
  [0-12] textbox: Email
  [0-3] LabelText: Work address
  [0-13] textbox: Email`;
    const seen = serve("perplexity", (key) =>
      key === "cardinality" ? { choice: "all", p: 0.99 } : undefined,
    );
    await selectObservation(config(), snap, "Find the work email");
    const membership = JSON.parse(
      (seen[1]!.body.questions as Record<string, { instructions: string }>)["match_0-13"]!
        .instructions,
    );
    expect(membership.candidate).toMatchObject({ near_text: "Work address", occurrence: "2 of 2" });
  });
  it("redacts previously visible variable values and retains placeholders in fill proposals", async () => {
    const snap = snapshot();
    snap.facts["0-12"]!.context = "Account secret@example.test";
    const seen = serve("perplexity", (key) =>
      key === "operation" ? { choice: "fill", p: 0.99 } : undefined,
    );
    const result = await selectObservation(config(), snap, "Fill Field 1 with %email%", {
      email: "secret@example.test",
    });
    expect(JSON.stringify(seen)).not.toContain("secret@example.test");
    expect(result).toMatchObject({ kind: "done", actions: [{ arguments: ["%email%"] }] });
  });
  it("uses the ordinary path for unbounded arguments and unsupported operations", async () => {
    serve("perplexity", (key) => (key === "operation" ? { choice: "fill", p: 0.99 } : undefined));
    expect(
      await selectObservation(config(), snapshot(), "Type a greeting into Field 1"),
    ).toMatchObject({ kind: "fallback", reason: "unbounded_arguments" });
    serve("perplexity", (key) =>
      key === "operation" ? { choice: "unsupported", p: 0.99 } : undefined,
    );
    expect(await selectObservation(config(), snapshot(), "Drag Field 1")).toMatchObject({
      kind: "fallback",
      reason: "unsupported_observation",
    });
  });
  it("does not silently omit a frame or shadow target without browser evidence", async () => {
    const snap = snapshot();
    delete snap.facts["0-12"];
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await selectObservation(config(), snap, "Find all fields")).toMatchObject({
      kind: "fallback",
      reason: "unrepresented_candidates:1",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not omit an unresolved button nested in a contenteditable region", async () => {
    const snap = snapshot();
    snap.formattedTree += "\n    [0-99] button: Editor options";
    snap.facts["0-12"]!.tag = "div";
    expect(await selectObservation(config(), snap, undefined)).toMatchObject({
      kind: "fallback",
      reason: "unrepresented_candidates:1",
    });
  });
  it("allows browser-owned controls to be represented by their native input", async () => {
    const snap = snapshot();
    snap.formattedTree += "\n    [0-99] button: Increment";
    expect(await selectObservation(config(), snap, undefined)).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/input[1]", method: "fill" }],
    });
  });
  it("discovers controls without model inference", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await selectObservation(config(), snapshot(3), undefined);
    expect(result.kind === "done" && result.actions).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects replacement at the same XPath before returning an observation", async () => {
    serve();
    const before = snapshot();
    const after = snapshot();
    after.formattedTree = after.formattedTree.replace("0-12", "0-99");
    after.xpathMap = { "0-99": "/html/body/input[1]" };
    after.facts = { "0-99": after.facts["0-12"]! };
    after.editableIds = ["0-99"];
    const result = await runDecisionsObserve(config(), {
      page: page(before, after) as never,
      logger: logger(),
      instruction: "Find Field 1",
      snapshotOptions: {},
      progress: new Progress("observe", 0),
    });
    expect(result).toMatchObject({ kind: "fallback", reason: "observation_evidence_changed" });
  });
  it("invalidates empty results when a new candidate appears", async () => {
    serve("perplexity", (key) =>
      key === "target"
        ? { choice: "none_match", p: 0.99 }
        : key === "exists"
          ? { p: 0.01 }
          : undefined,
    );
    expect(
      await runDecisionsObserve(config(), {
        page: page(snapshot(), snapshot(2)) as never,
        logger: logger(),
        instruction: "Find Field 2",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "observation_evidence_changed" });
  });
  it("revalidates sibling labels before returning a selected target", async () => {
    serve();
    const before = snapshot();
    before.formattedTree = before.formattedTree.replace(
      "  [0-12]",
      "  [0-2] LabelText: Personal address\n  [0-12]",
    );
    const after = { ...before, formattedTree: before.formattedTree.replace("Personal", "Work") };
    expect(
      await runDecisionsObserve(config(), {
        page: page(before, after) as never,
        logger: logger(),
        instruction: "Find the personal address",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "observation_evidence_changed" });
  });
  it("invalidates observations when navigation preserves the control tree", async () => {
    serve();
    const browser = page(snapshot());
    browser.url = () =>
      browser.captureSnapshot.mock.calls.length > 1
        ? "https://contact.test/next"
        : "https://contact.test/";
    expect(
      await runDecisionsObserve(config(), {
        page: browser as never,
        logger: logger(),
        instruction: "Find Field 1",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "observation_evidence_changed" });
  });
  it("preserves custom instructions through ordinary observation", async () => {
    const browser = page(snapshot());
    expect(
      await runDecisionsObserve(config(), {
        page: browser as never,
        logger: logger(),
        instruction: "Find Field 1",
        systemPrompt: "Only return explicitly named controls",
        snapshotOptions: {},
        progress: new Progress("observe", 0),
      }),
    ).toMatchObject({ kind: "fallback", reason: "custom_instructions" });
    expect(browser.captureSnapshot).not.toHaveBeenCalled();
  });
  it("includes decision usage on direct service results and preserves scope", async () => {
    serve();
    const browser = page(snapshot());
    const llm = vi.fn();
    const result = await observe({
      params: {
        pageId: "test-page",
        instruction: "Find Field 1",
        options: { locator: { selector: "main" }, cache: false },
      },
      page: browser as never,
      logger: logger(),
      model: undefined,
      clientLLMGenerate: llm,
      decisions: config(),
    });
    expect(result.metadata.usage.inputTokens).toBe(80);
    expect(() => ObserveResultSchema.parse(result)).not.toThrow();
    expect(browser.captureSnapshot).toHaveBeenCalledWith(
      { focusLocator: { selector: "main" }, ignoreLocators: undefined },
      expect.any(Progress),
    );
    expect(llm).not.toHaveBeenCalled();
  });
  it("charges attempted decisions and fallback inference exactly once", async () => {
    serve("perplexity", (key) =>
      key === "operation" ? { choice: "unsupported", p: 0.99 } : undefined,
    );
    const clientLLMGenerate = vi.fn(async () => ({
      role: "assistant" as const,
      content: { type: "text" as const, text: "observation" },
      outputFormat: "json_schema" as const,
      structuredContent: {
        elements: [{ elementId: "0-12", description: "Field 1", method: "fill", arguments: [] }],
      },
      usage: {
        inputTokens: 11,
        outputTokens: 4,
        totalTokens: 15,
        reasoningTokens: 2,
        cachedInputTokens: 3,
      },
    }));
    const result = await observe({
      params: { pageId: "test-page", instruction: "Press Enter", options: { cache: false } },
      page: page(snapshot()) as never,
      logger: logger(),
      model: { source: "client" },
      clientLLMGenerate,
      decisions: config(),
    });
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 51,
      outputTokens: 7,
      reasoningTokens: 2,
      cachedInputTokens: 3,
    });
    expect(() => ObserveResultSchema.parse(result)).not.toThrow();
    expect(clientLLMGenerate).toHaveBeenCalledTimes(1);
  });
  it("aborts a pending decision at the shared deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
          ),
      ),
    );
    const progress = new Progress("observe", 10);
    try {
      await expect(
        runDecisionsObserve(config(), {
          page: page(snapshot()) as never,
          logger: logger(),
          instruction: "Find Field 1",
          snapshotOptions: {},
          progress,
        }),
      ).rejects.toThrow("timed out");
    } finally {
      progress.dispose();
    }
  });
});
