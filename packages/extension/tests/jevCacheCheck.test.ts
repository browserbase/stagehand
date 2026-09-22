import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { checkCachedAction } from "../services/jevAct/cacheCheck.js";
import type { AskContext, Snapshot } from "../services/jevAct/pick.js";
import { parseOutline } from "../services/jevAct/tree.js";

const PAGE = [
  "[0-1] RootWebArea: Shop",
  "  [0-2] navigation: Main",
  "    [0-3] link: Cart",
  "  [0-4] main",
  "    [0-5] heading: Blue kettle",
  "    [0-6] button: Add to cart",
  "    [0-7] heading: Red toaster",
  "    [0-8] button: Add to cart",
].join("\n");

function context(): AskContext {
  return {
    config: { apiKey: "test" },
    instruction: "click Add to cart for the red toaster",
    trace: [],
    threshold: 0.7,
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-cache-check-test") }, () => {}),
    ensureTimeRemaining: () => {},
  };
}

function stubNouls(values: Record<string, number>) {
  const bodies: Array<{ state: unknown; questions: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((key) => [
          key,
          { type: "noul", noul: values[key] ?? 0.02 },
        ]),
      );
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers,
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      );
    }),
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

describe("jev cache check", () => {
  const snap = (tree: string, xpathMap: Record<string, string>): Snapshot => ({
    tree,
    xpathMap,
    nodes: parseOutline(tree),
  });
  const cached = {
    selector: "xpath=/html/body/main/button[2]",
    description: "button: Add to cart",
    method: "click",
    arguments: [],
  };

  it("flags a selector that now resolves to a different control", async () => {
    const bodies = stubNouls({ still_matches: 0.04 });
    const moved = PAGE.replace("[0-8] button: Add to cart", "[0-8] button: Remove from wishlist");
    const verdict = await checkCachedAction(
      context(),
      snap(moved, { "0-8": "/html/body/main/button[2]/text()" }),
      cached,
    );

    expect(verdict).toEqual({
      verdict: "stale",
      score: 0.04,
      found: "button: Remove from wishlist",
    });
    expect(bodies[0]!.state).toMatchObject({
      cached_action: { description: "button: Add to cart" },
    });
  });

  it("passes a matching element and stays out of the way when the selector is absent", async () => {
    stubNouls({ still_matches: 0.93 });
    expect(
      await checkCachedAction(
        context(),
        snap(PAGE, { "0-8": "/html/body/main/button[2]" }),
        cached,
      ),
    ).toEqual({
      verdict: "match",
      score: 0.93,
    });
    expect(await checkCachedAction(context(), snap(PAGE, {}), cached)).toEqual({
      verdict: "unknown",
    });
  });
});

describe("jev cache check boundaries", () => {
  const cached = {
    selector: "xpath=/html/body/main/button[2]",
    description: "button: Add to cart",
    method: "click",
    arguments: [],
  };
  const page = (): Snapshot => ({
    tree: PAGE,
    xpathMap: { "0-8": "/html/body/main/button[2]", "0-1": "/html[1]" },
    nodes: parseOutline(PAGE),
  });

  it("pins the stale/match boundary at 0.35 with a strict less-than", async () => {
    stubNouls({ still_matches: 0.3 });
    expect((await checkCachedAction(context(), page(), cached)).verdict).toBe("stale");
    stubNouls({ still_matches: 0.35 });
    expect((await checkCachedAction(context(), page(), cached)).verdict).toBe("match");
    stubNouls({ still_matches: 0.4 });
    expect((await checkCachedAction(context(), page(), cached)).verdict).toBe("match");
  });

  it("resolves the document root whether it is written /html or /html[1]", async () => {
    stubNouls({ still_matches: 0.9 });
    const press = {
      selector: "xpath=/html",
      description: "press Enter",
      method: "press",
      arguments: ["Enter"],
    };
    expect((await checkCachedAction(context(), page(), press)).verdict).toBe("match");
  });
});
