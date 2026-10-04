import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Action,
  ActResultData,
  WebMCPToolDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../logger.js";
import { DECISION_PROVIDERS, type DecisionProviderName } from "../services/decisions/client.js";
import { runDecisionsExtract } from "../services/decisions/extract/index.js";
import { runDecisionsObserve } from "../services/decisions/observe.js";
import { runDecisionsAct, type DecisionsActDeps } from "../services/decisions/act/index.js";
import type { DecisionsConfig } from "../services/decisions/config.js";
import { parseOutline } from "../services/decisions/tree.js";
import type { Page } from "../understudy/page.js";
import {
  fakeDecisionProvider,
  type ScriptedAnswer,
  type WireQuestion,
} from "./decisionsTestUtils.js";

vi.mock("../understudy/deepLocator.js", () => ({
  resolveLocatorWithHops: vi.fn(async () => ({ inputValue: async () => "Ada" })),
}));

/**
 * The same act / observe / extract / tool scenarios through every provider's
 * wire format. The scripted model answers by what a question says, not by
 * its key, because providers with a strict id alphabet see aliased keys.
 */
const SHOP = [
  "[0-1] RootWebArea: Shop",
  "  [0-3] textbox: Email",
  "  [0-4] textbox: Name",
  "  [0-5] button: Add to cart",
  "  [0-7] button: Checkout",
  "  [0-9] link: Help",
  "  [0-11] paragraph",
  "    [0-12] StaticText: Price:",
  "    [0-13] StaticText: $1,249.50",
].join("\n");
const XPATHS = Object.fromEntries(
  [3, 4, 5, 7, 9, 11, 12, 13].map((n) => [`0-${n}`, `/html/body/*[${n}]`]),
);

function config(provider: DecisionProviderName): DecisionsConfig {
  return {
    provider,
    apiKey: `key-${provider}-${Math.random()}`,
    ...(provider === "cloudflare" ? { accountId: "acct123" } : {}),
  };
}

function logger() {
  return new StagehandLogger(
    { tracer: trace.getTracer("decisions-cross-provider-test") },
    () => {},
  );
}

function actDeps(instruction: string, overrides: Partial<DecisionsActDeps> = {}) {
  const takeAction = vi.fn(
    async (action: Action): Promise<ActResultData> => ({
      success: true,
      message: "ok",
      actionDescription: action.description,
      actions: [action],
    }),
  );
  const deps: DecisionsActDeps = {
    page: {
      captureSnapshot: vi.fn(async () => ({
        combinedTree: SHOP,
        combinedXpathMap: XPATHS,
        combinedUrlMap: {},
      })),
      mainFrame: () => ({}),
      url: () => "https://shop.test/cart?session=abc",
    } as unknown as Page,
    logger: logger(),
    instruction,
    snapshotOptions: {},
    ensureTimeRemaining: () => {},
    takeAction,
    ...overrides,
  };
  return { deps, takeAction };
}

/** Picks the option whose description mentions `needle`. */
function optionAbout(question: WireQuestion, needle: string): string | undefined {
  return Object.entries(question.descriptions).find(([, text]) => text.includes(needle))?.[0];
}

function intent(family: string) {
  return (key: string): ScriptedAnswer | undefined =>
    key === "family" ? { choice: family, p: 0.98 } : undefined;
}

function serve(
  provider: DecisionProviderName,
  script: (key: string, question: WireQuestion) => ScriptedAnswer | undefined,
) {
  return fakeDecisionProvider(provider, script, (fetchMock) =>
    vi.stubGlobal("fetch", vi.fn(fetchMock)),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe.each(DECISION_PROVIDERS)("decisions pipeline on %s", (provider) => {
  it("clicks the element the model picked", async () => {
    const seen = serve(provider, (key, question) => {
      if (key === "best" || key === "strict") {
        return { choice: optionAbout(question, "Checkout"), p: 0.96 };
      }
      return intent("click")(key);
    });
    const { deps, takeAction } = actDeps("click the Checkout button");
    const outcome = await runDecisionsAct(config(provider), deps);
    expect(outcome.kind).toBe("done");
    expect(takeAction).toHaveBeenCalledTimes(1);
    expect(takeAction.mock.calls[0]![0]).toMatchObject({
      selector: "xpath=/html/body/*[7]",
      method: "click",
    });
    // Whatever the wire shape, the page URL leaves without its query string.
    expect(JSON.stringify(seen.map((request) => request.body))).not.toContain("session=abc");
  });

  it("types the quoted value into the field the model picked", async () => {
    serve(provider, (key, question) => {
      if (key === "fill_value") return { choice: optionAbout(question, "Ada"), p: 0.97 };
      if (key === "best" || key === "strict")
        return { choice: optionAbout(question, "Name"), p: 0.95 };
      return intent("fill")(key);
    });
    const { deps, takeAction } = actDeps("type 'Ada' into the Name field");
    const outcome = await runDecisionsAct(config(provider), deps);
    expect(outcome.kind).toBe("done");
    expect(takeAction.mock.calls[0]![0]).toMatchObject({
      selector: "xpath=/html/body/*[4]",
      method: "fill",
      arguments: ["Ada"],
    });
  });

  it("hands off to the LLM when the model says nothing matches", async () => {
    serve(provider, (key, question) => {
      if (key === "strict") return { choice: "none_match", p: 0.97 };
      // Unsure, but still a real distribution: the leader is the most likely option.
      if (key === "best") return { choice: question.options[0], p: 0.45 };
      return intent("click")(key);
    });
    const { deps, takeAction } = actDeps("click the Wishlist button");
    const outcome = await runDecisionsAct(config(provider), deps);
    expect(outcome.kind).toBe("fallback");
    expect(takeAction).not.toHaveBeenCalled();
  });

  it("observes every element the model marks relevant", async () => {
    serve(provider, (key, question) => {
      if (key === "family") return { choice: "fill", p: 0.97 };
      if (key === "cardinality") return { choice: "several", p: 0.96 };
      if (question.type === "noul") return { p: key === "0-3" || key === "0-4" ? 0.93 : 0.04 };
      return undefined;
    });
    const outcome = await runDecisionsObserve(config(provider), {
      page: {
        captureSnapshot: vi.fn(async () => ({
          combinedTree: SHOP,
          combinedXpathMap: XPATHS,
          combinedUrlMap: {},
        })),
      } as never,
      logger: logger(),
      instruction: "find all the text fields",
      snapshotOptions: {},
      ensureTimeRemaining: () => {},
    });
    expect(outcome.kind).toBe("done");
    expect(outcome.kind === "done" && outcome.actions.map((action) => action.selector)).toEqual([
      "xpath=/html/body/*[3]",
      "xpath=/html/body/*[4]",
    ]);
  });

  it("extracts by picking the element and copying its text", async () => {
    serve(provider, (key, question) => {
      if (key === "completed") return { p: 0.92 };
      if (question.type === "choice") {
        return { choice: optionAbout(question, "1,249.50") ?? "none_match", p: 0.94 };
      }
      return { p: 0.9 };
    });
    const outcome = await runDecisionsExtract(config(provider), {
      logger: logger(),
      instruction: "extract the price",
      schema: { type: "object", required: ["price"], properties: { price: { type: "number" } } },
      snap: { tree: SHOP, xpathMap: {}, nodes: parseOutline(SHOP) },
      urlMap: {},
      ensureTimeRemaining: () => {},
      gate: true,
    });
    expect(outcome).toMatchObject({ kind: "done", data: { price: 1249.5 } });
  });

  it("invokes a page tool with arguments read from the instruction", async () => {
    const tools: WebMCPToolDescriptor[] = [
      {
        name: "add_to_cart",
        description: "Add a product to the cart",
        frameId: "main",
        inputSchema: {
          type: "object",
          required: ["product_id"],
          properties: { product_id: { type: "string" }, quantity: { type: "integer" } },
        },
      },
      { name: "clear_cart", description: "Empty the cart", frameId: "main" },
    ];
    const invoked: Array<{ name: string; input: unknown }> = [];
    const seen = serve(provider, (key, question) => {
      if (key === "family") return { choice: "not_an_action", p: 0.99 };
      if (key === "tool_best") return { choice: "add_to_cart", p: 0.97 };
      if (key === "tool_strict") return { choice: "add_to_cart", p: 0.96 };
      if (key === "tool_names_control") return { p: 0.03 };
      // Argument questions: keyed "tool_arg:add_to_cart:<param>", aliased where colons are not allowed.
      if (question.text.includes("parameter 'product_id'")) {
        return { choice: optionAbout(question, "the exact words: p_102"), p: 0.97 };
      }
      if (question.text.includes("parameter 'quantity'")) {
        return {
          choice: Object.entries(question.descriptions).find(([, text]) =>
            text.endsWith("the exact words: 2"),
          )?.[0],
          p: 0.95,
        };
      }
      return undefined;
    });
    const { deps } = actDeps("add 2 of product p_102 to my cart", {
      page: {} as Page,
      webmcp: {
        tools: Promise.resolve(tools),
        page: {
          invokeWebMCPTool: async (frameId, toolName, options) => {
            invoked.push({ name: toolName, input: options?.input });
            return { invocationId: "inv-1", toolName, frameId, input: options?.input ?? {} };
          },
          waitForWebMCPInvocationResult: async () => ({
            invocationId: "inv-1",
            status: "Completed",
            output: { ok: true },
          }),
        },
      },
    });
    const outcome = await runDecisionsAct({ ...config(provider), tools: true }, deps);
    expect(outcome).toMatchObject({ kind: "done", viaTool: { argumentLlm: false } });
    expect(invoked).toEqual([{ name: "add_to_cart", input: { product_id: "p_102", quantity: 2 } }]);
    // One request carried intent, tool choice and the arguments.
    expect(seen).toHaveLength(1);
  });
});
