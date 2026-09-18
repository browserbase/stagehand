import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebMCPToolDescriptor } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../logger.js";
import { runJevToolAct, type JevToolActDeps } from "../services/jevAct/toolAct.js";
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
        if (key === "strict") probabilities.none_of_these = script.none ?? 0;
        if (key !== "best" && key !== "strict") {
          choice = "unset";
          confidence = 0.95;
        }
        if (script.args && key in script.args) {
          const [wanted, p] = script.args[key]!;
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

function deps(
  instruction: string,
  overrides: Partial<JevToolActDeps> = {},
): JevToolActDeps & { invoked: Array<{ name: string; input: unknown }> } {
  const invoked: Array<{ name: string; input: unknown }> = [];
  return {
    invoked,
    instruction,
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-tools-test") }, () => {}),
    ensureTimeRemaining: () => {},
    page: {
      listWebMCPTools: async () => tools,
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
}

const config = { apiKey: "test", tools: true };

describe("Jev WebMCP tool act", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("invokes a tool that takes no input on one Jev request", async () => {
    const requests = stubJev({ tool: "clear_cart" });
    const d = deps("empty my cart");
    const outcome = await runJevToolAct(config, d);
    expect(outcome.kind).toBe("done");
    expect(d.invoked).toEqual([{ name: "clear_cart", input: {} }]);
    expect(requests).toHaveLength(1);
    if (outcome.kind !== "done") return;
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.actions[0]).toMatchObject({
      selector: "webmcp:clear_cart",
      method: "webmcp",
      arguments: ["{}"],
    });
  });

  it("fills scalar arguments from the instruction's own words", async () => {
    stubJev({
      tool: "add_to_cart",
      args: { product_id: ["p_102", 0.97], quantity: ["2", 0.95], size: ["M", 0.93] },
    });
    const d = deps("put 2 of item p_102, size M, into my basket");
    const outcome = await runJevToolAct(config, d);
    expect(outcome.kind).toBe("done");
    expect(d.invoked[0]).toEqual({
      name: "add_to_cart",
      input: { product_id: "p_102", quantity: 2, size: "M" },
    });
  });

  it("leaves requests that name a control to the element path", async () => {
    stubJev({ tool: "add_to_cart", namesControl: 0.97 });
    const d = deps("click the Add to cart button");
    expect(await runJevToolAct(config, d)).toEqual({ kind: "skip", reason: "names_a_control" });
    expect(d.invoked).toEqual([]);
  });

  it("skips when no tool fits or the choice is split", async () => {
    stubJev({ tool: "clear_cart", none: 0.6 });
    expect(await runJevToolAct(config, deps("open the footer newsletter link"))).toEqual({
      kind: "skip",
      reason: "no_tool_fits",
    });
    stubJev({ tool: "clear_cart", toolP: 0.55 });
    expect(await runJevToolAct(config, deps("sort out my cart"))).toEqual({
      kind: "skip",
      reason: "tool_ambiguous",
    });
  });

  it("hands unsure or non-scalar arguments to the argument LLM, and skips without one", async () => {
    stubJev({ tool: "add_to_cart", args: { product_id: ["p_102", 0.55] } });
    const fillArguments = vi.fn(async () => ({ product_id: "p_102" }));
    const d = deps("add that p_102 thing", { fillArguments });
    const outcome = await runJevToolAct(config, d);
    expect(outcome).toMatchObject({ kind: "done", usedArgumentLlm: true });
    expect(d.invoked[0]?.input).toEqual({ product_id: "p_102" });

    stubJev({ tool: "search_flights" });
    const nested = deps("fly SFO to JFK then on to BOS");
    expect(await runJevToolAct({ ...config, argumentLlm: false }, nested)).toEqual({
      kind: "skip",
      reason: "arguments_not_filled",
    });
    expect(nested.invoked).toEqual([]);
  });

  it("skips when a required argument is not stated", async () => {
    stubJev({ tool: "add_to_cart", args: { product_id: ["unset", 0.95] } });
    const d = deps("add something nice to my cart");
    expect(await runJevToolAct(config, d)).toEqual({
      kind: "skip",
      reason: "arguments_not_filled",
    });
  });

  it("never sends a variable's value to TypeSafe and resolves it only for the page", async () => {
    const requests = stubJev({ tool: "add_to_cart", args: { product_id: ["%sku%", 0.96] } });
    const d = deps("add item %sku% to my cart", { variables: { sku: "secret-sku-9" } });
    const outcome = await runJevToolAct(config, d);
    expect(JSON.stringify(requests)).not.toContain("secret-sku-9");
    expect(d.invoked[0]?.input).toEqual({ product_id: "secret-sku-9" });
    expect(outcome.kind === "done" && outcome.result.actions[0]?.arguments?.[0]).toBe(
      '{"product_id":"%sku%"}',
    );
  });

  it("reports a tool error as a failed act instead of falling through to the UI", async () => {
    stubJev({ tool: "clear_cart" });
    const d = deps("empty my cart");
    d.page.waitForWebMCPInvocationResult = async () => {
      throw new Error("Timed out waiting for WebMCP tool");
    };
    const outcome = await runJevToolAct(config, d);
    expect(outcome).toMatchObject({ kind: "done", result: { success: false } });
  });

  it("skips without asking Jev when the page has no tools or no WebMCP support", async () => {
    const requests = stubJev({});
    const d = deps("empty my cart");
    d.page.listWebMCPTools = async () => {
      throw new Error("'WebMCP.enable' wasn't found");
    };
    expect(await runJevToolAct(config, d)).toEqual({ kind: "skip", reason: "no_tools" });
    expect(requests).toHaveLength(0);
  });

  it("builds spans from quotes and word runs without punctuation or possessives", () => {
    const spans = instructionSpans(`export doc_45's sequence as "plain FASTA", please.`);
    expect(spans[0]).toBe("plain FASTA");
    expect(spans).toContain("doc_45");
    expect(spans).toContain("please");
    expect(spans).not.toContain("doc_45's");
  });
});
