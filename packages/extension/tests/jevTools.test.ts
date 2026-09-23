import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LLMGenerateParams,
  LLMGenerateResult,
  WebMCPToolDescriptor,
} from "@browserbasehq/stagehand-protocol/types";
import { toolArguments } from "../inference.js";
import { StagehandLogger } from "../logger.js";
import type { Variables } from "@browserbasehq/stagehand-protocol/types";
import { runJevActPipeline, type JevActDeps } from "../services/jevAct/pipeline.js";
import type { JevToolDeps } from "../services/jevAct/toolAct.js";
import { instructionSpans } from "../services/jevAct/tools.js";

const tools: WebMCPToolDescriptor[] = [
  {
    name: "add_to_cart",
    description: "Add a product to the cart",
    frameId: "main",
    inputSchema: {
      type: "object",
      required: ["product_id"],
      properties: {
        product_id: { type: "string" },
        quantity: { type: "integer" },
        size: { type: "string", enum: ["S", "M", "L"] },
      },
    },
  },
  { name: "clear_cart", description: "Empty the cart", frameId: "main" },
  {
    name: "search_flights",
    description: "Search flights",
    frameId: "main",
    inputSchema: { type: "object", properties: { legs: { type: "array" } } },
  },
];

type Probabilities = Record<string, number>;
type Scripted = {
  tool?: string;
  toolP?: number;
  none?: number;
  namesControl?: number;
  /** Per parameter: the wanted option (a span's text, an enum value, "unset") and its confidence. */
  args?: Record<string, [string, number]>;
};

/** Answers tool questions from a script; span and enum options are looked up by their text. */
function stubJev(script: Scripted) {
  const requests: Array<Record<string, { criteria?: Record<string, string> }>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        questions: Record<string, { type: string; criteria?: Record<string, string> }>;
      };
      requests.push(body.questions);
      const answers: Record<string, unknown> = {};
      for (const [key, question] of Object.entries(body.questions)) {
        if (question.type === "noul") {
          answers[key] = { type: "noul", noul: script.namesControl ?? 0 };
          continue;
        }
        let choice = script.tool ?? "clear_cart";
        let confidence = script.toolP ?? 0.95;
        const probabilities: Probabilities = {};
        if (key === "tool_strict") probabilities.none_of_these = script.none ?? 0;
        if (key === "family") {
          answers[key] = {
            type: "choice",
            choice: "not_an_action",
            confidence: 0.99,
            probabilities: { not_an_action: 0.99 },
          };
          continue;
        }
        if (key !== "tool_best" && key !== "tool_strict") {
          choice = "unset";
          confidence = 0.95;
        }
        const parameter = key.startsWith("tool_arg:") ? key.split(":")[2]! : key;
        if (
          script.args &&
          key.startsWith("tool_arg:") &&
          !key.startsWith(`tool_arg:${script.tool}:`)
        ) {
          // A lexical favourite that is not the scripted winner.
        } else if (script.args && parameter in script.args) {
          const [wanted, p] = script.args[parameter]!;
          choice =
            Object.entries(question.criteria ?? {}).find(
              ([id, text]) =>
                id === wanted ||
                text.endsWith(`: ${wanted}`) ||
                text.endsWith(` ${JSON.stringify(wanted)}`),
            )?.[0] ?? "unset";
          confidence = p;
        }
        probabilities[choice] = confidence;
        answers[key] = { type: "choice", choice, confidence, probabilities };
      }
      return new Response(JSON.stringify({ answers, usage: { input_tokens: 10 } }), {
        status: 200,
      });
    }),
  );
  return requests;
}

type Harness = {
  deps: JevActDeps;
  invoked: Array<{ name: string; input: unknown }>;
  /** `tool_skip` from the intent trace entry of the last run. */
  skipReason: () => string | undefined;
  webmcp: JevToolDeps;
};

function harness(instruction: string, overrides: Partial<JevToolDeps> = {}, variables?: Variables) {
  const invoked: Harness["invoked"] = [];
  const logged: string[] = [];
  const webmcp: JevToolDeps = {
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
    ...overrides,
  };
  const deps = {
    instruction,
    ...(variables ? { variables } : {}),
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-tools-test") }, (line) => {
      logged.push(JSON.stringify(line));
    }),
    ensureTimeRemaining: () => {},
    snapshotOptions: {},
    // The scripted intent is "not an action", so a skipped tool ends the act
    // before any page work.
    page: {} as JevActDeps["page"],
    takeAction: async () => {
      throw new Error("no element action expected");
    },
    webmcp,
  } satisfies JevActDeps;
  const skipReason = (): string | undefined =>
    /tool_skip\\*":\\*"([a-z_]+)/.exec(logged.join("\n"))?.[1];
  return { deps, invoked, skipReason, webmcp } satisfies Harness;
}

const config = { apiKey: "test", tools: true };

describe("Jev WebMCP tool act", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("invokes a tool that takes no input inside the intent request", async () => {
    const requests = stubJev({ tool: "clear_cart" });
    const h = harness("empty my cart");
    const outcome = await runJevActPipeline(config, h.deps);
    expect(h.invoked).toEqual([{ name: "clear_cart", input: {} }]);
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!)).toEqual(expect.arrayContaining(["family", "tool_best"]));
    expect(outcome).toMatchObject({
      kind: "done",
      noCache: true,
      viaTool: { argumentLlm: false },
      result: {
        success: true,
        actions: [{ selector: "webmcp:clear_cart", method: "webmcp", arguments: ["{}"] }],
      },
    });
  });

  it("fills scalar arguments from the instruction's own words in the same request", async () => {
    const requests = stubJev({
      tool: "add_to_cart",
      args: { product_id: ["p_102", 0.97], quantity: ["2", 0.95], size: ["M", 0.93] },
    });
    const h = harness("add 2 of product p_102, size M, to my cart");
    await runJevActPipeline(config, h.deps);
    expect(requests).toHaveLength(1);
    expect(h.invoked[0]).toEqual({
      name: "add_to_cart",
      input: { product_id: "p_102", quantity: 2, size: "M" },
    });
  });

  it("asks once more when the winner was not a lexical favourite", async () => {
    const requests = stubJev({ tool: "add_to_cart", args: { product_id: ["p_102", 0.97] } });
    const h = harness("I want p_102");
    await runJevActPipeline(config, h.deps);
    expect(requests).toHaveLength(2);
    expect(h.invoked[0]?.input).toEqual({ product_id: "p_102" });
  });

  it("leaves requests that name a control to the element path", async () => {
    stubJev({ tool: "add_to_cart", namesControl: 0.97 });
    const h = harness("click the Add to cart button");
    await runJevActPipeline(config, h.deps);
    expect(h.invoked).toEqual([]);
    expect(h.skipReason()).toBe("names_a_control");
  });

  it("skips when no tool fits or the choice is split", async () => {
    stubJev({ tool: "clear_cart", none: 0.6 });
    const none = harness("open the footer newsletter link");
    await runJevActPipeline(config, none.deps);
    expect(none.skipReason()).toBe("no_tool_fits");

    stubJev({ tool: "clear_cart", toolP: 0.55 });
    const split = harness("sort out my cart");
    await runJevActPipeline(config, split.deps);
    expect(split.skipReason()).toBe("tool_ambiguous");
    expect([...none.invoked, ...split.invoked]).toEqual([]);
  });

  it("hands unsure arguments to the argument LLM, and skips without one", async () => {
    stubJev({ tool: "add_to_cart", args: { product_id: ["p_102", 0.55] } });
    const fillArguments = vi.fn(async () => ({ product_id: "p_102" }));
    const h = harness("add that p_102 product to the cart", { fillArguments });
    const outcome = await runJevActPipeline(config, h.deps);
    expect(outcome).toMatchObject({ kind: "done", viaTool: { argumentLlm: true } });
    expect(h.invoked[0]?.input).toEqual({ product_id: "p_102" });

    stubJev({ tool: "add_to_cart", args: { product_id: ["p_102", 0.55] } });
    const without = harness("add that p_102 product to the cart");
    await runJevActPipeline({ ...config, argumentLlm: false }, without.deps);
    expect(without.invoked).toEqual([]);
    expect(without.skipReason()).toBe("arguments_not_filled");
  });

  it("starts the argument LLM alongside Jev when the likely tool takes a list or object", async () => {
    let jevAnswered = false;
    stubJev({ tool: "search_flights" });
    const fillArguments = vi.fn(async () => {
      expect(jevAnswered).toBe(false);
      return { legs: ["SFO-JFK"] };
    });
    const h = harness("search flights from SFO to JFK", { fillArguments });
    const ensure = h.deps.ensureTimeRemaining;
    // ensureTimeRemaining runs again right before the invocation, after Jev answered.
    let calls = 0;
    h.deps.ensureTimeRemaining = () => {
      if (++calls > 1) jevAnswered = true;
      ensure();
    };
    await runJevActPipeline(config, h.deps);
    expect(fillArguments).toHaveBeenCalledTimes(1);
    expect(h.invoked[0]?.input).toEqual({ legs: ["SFO-JFK"] });
  });

  it("does not trust one span filling two parameters", async () => {
    stubJev({ tool: "add_to_cart", args: { product_id: ["2", 0.95], quantity: ["2", 0.95] } });
    const fillArguments = vi.fn(async () => ({ product_id: "2" }));
    const h = harness("add product 2 to my cart", { fillArguments });
    await runJevActPipeline(config, h.deps);
    expect(fillArguments).toHaveBeenCalledTimes(1);
    expect(h.invoked[0]?.input).toEqual({ product_id: "2" });
  });

  it("skips when a required argument is not stated", async () => {
    stubJev({ tool: "add_to_cart", args: { product_id: ["unset", 0.95] } });
    const h = harness("add a nice product to my cart");
    await runJevActPipeline(config, h.deps);
    expect(h.invoked).toEqual([]);
    expect(h.skipReason()).toBe("arguments_not_filled");
  });

  it("never sends a variable's value to TypeSafe and resolves it only for the page", async () => {
    const requests = stubJev({ tool: "add_to_cart", args: { product_id: ["%sku%", 0.96] } });
    const h = harness("add product %sku% to my cart", {}, { sku: "secret-sku-9" });
    const outcome = await runJevActPipeline(config, h.deps);
    expect(JSON.stringify(requests)).not.toContain("secret-sku-9");
    expect(h.invoked[0]?.input).toEqual({ product_id: "secret-sku-9" });
    expect(outcome.kind === "done" && outcome.result.actions[0]?.arguments?.[0]).toBe(
      '{"product_id":"%sku%"}',
    );
  });

  it("resolves %variables% nested inside LLM-shaped arguments and redacts what the tool echoes", async () => {
    stubJev({ tool: "search_flights" });
    const fillArguments = vi.fn(async () => ({ legs: ["%from%-%to%"], note: { who: "%from%" } }));
    const h = harness("fly %from% to %to%", { fillArguments }, { from: "SFO", to: "JFK" });
    h.webmcp.page.waitForWebMCPInvocationResult = async () => ({
      invocationId: "inv-1",
      status: "Completed",
      output: { booked: "SFO-JFK for SFO" },
    });
    const outcome = await runJevActPipeline(config, h.deps);
    expect(h.invoked[0]?.input).toEqual({ legs: ["SFO-JFK"], note: { who: "SFO" } });
    expect(outcome.kind === "done" && outcome.result.message).toContain("%from%-%to%");
    expect(outcome.kind === "done" && outcome.result.message).not.toContain("SFO");
  });

  it("invokes the tool only once the DOM-settle wait is over", async () => {
    stubJev({ tool: "clear_cart" });
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const h = harness("empty my cart");
    const running = runJevActPipeline(config, { ...h.deps, settled });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(h.invoked).toEqual([]);
    settle();
    expect((await running).kind).toBe("done");
    expect(h.invoked).toHaveLength(1);
  });

  it("reports a tool error as a failed act instead of falling through to the UI", async () => {
    stubJev({ tool: "clear_cart" });
    const h = harness("empty my cart");
    h.webmcp.page.waitForWebMCPInvocationResult = async () => {
      throw new Error("Timed out waiting for WebMCP tool");
    };
    const outcome = await runJevActPipeline(config, h.deps);
    expect(outcome).toMatchObject({ kind: "done", result: { success: false } });
  });

  it("adds no question when the page has no tools or no WebMCP support", async () => {
    const requests = stubJev({});
    const unsupported = Promise.reject<never>(new Error("no WebMCP domain"));
    const h = harness("empty my cart", { tools: unsupported });
    await runJevActPipeline(config, h.deps);
    expect(Object.keys(requests[0]!)).not.toContain("tool_best");
    expect(h.invoked).toEqual([]);
  });

  it("builds spans from quotes and word runs without punctuation or possessives", () => {
    const spans = instructionSpans(`export doc_45's sequence as "plain FASTA", please.`);
    expect(spans[0]).toBe("plain FASTA");
    expect(spans).toContain("doc_45");
    expect(spans).toContain("please");
    expect(spans).not.toContain("doc_45's");
  });
});

describe("toolArguments inference", () => {
  const usage = { inputTokens: 5, outputTokens: 2, totalTokens: 7 };

  it("shapes the answer with the tool's own schema when every property is required", async () => {
    const generate = vi.fn(async (request: LLMGenerateParams): Promise<LLMGenerateResult> => {
      expect(request.responseFormat).toMatchObject({
        schema: { required: ["a", "b"], properties: { a: { type: "number" } } },
      });
      return {
        role: "assistant",
        content: { type: "text", text: "" },
        outputFormat: "json_schema",
        structuredContent: { a: 1, b: 2 },
        usage,
      };
    });
    const result = await toolArguments({
      instruction: "add 1 and 2",
      variableNames: [],
      generate,
      tool: {
        name: "sum",
        description: "Add",
        inputSchema: {
          type: "object",
          required: ["a", "b"],
          properties: { a: { type: "number" }, b: { type: "number" } },
        },
      },
    });
    expect(result.input).toEqual({ a: 1, b: 2 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("carries the input as a JSON string when the schema has optional properties", async () => {
    const generate = vi.fn(async (request: LLMGenerateParams): Promise<LLMGenerateResult> => {
      expect(request.responseFormat).toMatchObject({ schema: { required: ["input_json"] } });
      return {
        role: "assistant",
        content: { type: "text", text: "" },
        outputFormat: "json_schema",
        structuredContent: { input_json: '{"query":"mugs"}' },
        usage,
      };
    });
    const result = await toolArguments({
      instruction: "search for mugs",
      variableNames: [],
      generate,
      tool: {
        name: "search",
        description: "Search",
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: { query: { type: "string" }, category: { type: "string" } },
        },
      },
    });
    expect(result.input).toEqual({ query: "mugs" });
    expect(result.prompt_tokens).toBe(5);
  });
});
