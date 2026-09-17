import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import {
  fillValueCandidates,
  groundedSpan,
  isGroundedText,
  matchOption,
} from "../services/jevAct/args.js";
import { blockingSignal, readPageState } from "../services/jevAct/pageState.js";
import type { AskContext } from "../services/jevAct/pick.js";
import {
  describeCandidate,
  exactNameMatches,
  focusOutline,
  pageDigest,
  parseOutline,
  scoreCandidates,
} from "../services/jevAct/tree.js";

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
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-modules-test") }, () => {}),
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

describe("jev act candidate helpers", () => {
  it("scores by shared words, with surrounding context breaking ties between twins", () => {
    const nodes = parseOutline(PAGE);
    const buttons = nodes.filter((node) => node.role === "button");
    const scores = scoreCandidates(nodes, buttons, "click Add to cart for the red toaster");

    expect(scores.get("0-8")!).toBeGreaterThan(scores.get("0-6")!);
    expect(scoreCandidates(nodes, buttons, "open the basket").get("0-6")).toBe(0);
  });

  it("matches quoted names exactly and case-insensitively", () => {
    const nodes = parseOutline(PAGE);
    expect(exactNameMatches(nodes, "cart").map((node) => node.id)).toEqual(["0-3"]);
    expect(exactNameMatches(nodes, "add to cart")).toHaveLength(2);
  });

  it("reduces the outline to a shortlist with ancestors", () => {
    const focused = focusOutline(parseOutline(PAGE), ["0-8"]);
    expect(focused.split("\n")).toEqual([
      "[0-1] RootWebArea: Shop",
      "  [0-4] main",
      "    [0-8] button: Add to cart",
    ]);
  });

  it("describes twins by the card or row they sit in", () => {
    const cards = parseOutline(
      [
        "[0-1] RootWebArea: Products",
        "  [0-2] div",
        "    [0-3] heading: Rs. 500",
        "    [0-4] paragraph: Blue Top",
        "    [0-5] link: Add to cart",
        "  [0-6] div",
        "    [0-7] heading: Rs. 400",
        "    [0-8] paragraph: Men Tshirt",
        "    [0-9] link: Add to cart",
        "  [0-10] row",
        "    [0-11] cell: Jason Doe",
        "    [0-12] checkbox",
      ].join("\n"),
    );
    expect(describeCandidate(cards, cards[8]!)).toMatchObject({
      group_text: "Rs. 400 · Men Tshirt",
      occurrence: "2 of 2",
    });
    expect(describeCandidate(cards, cards[11]!)).toMatchObject({ group_text: "Jason Doe" });
    expect(describeCandidate(cards, cards[3]!).group_text).toBeUndefined();
    expect(focusOutline(cards, ["0-9"])).toContain("Men Tshirt");
  });

  it("climbs past sibling controls to the row that names the item", () => {
    const table = parseOutline(
      [
        "[0-1] table",
        "  [0-2] row",
        "    [0-3] cell: Smith",
        "    [0-4] cell",
        "      [0-5] link: edit",
        "      [0-6] link: delete",
        "  [0-7] row",
        "    [0-8] cell: Doe",
        "    [0-9] cell",
        "      [0-10] link: edit",
        "      [0-11] link: delete",
      ].join("\n"),
    );
    expect(describeCandidate(table, table[9]!)).toMatchObject({
      group_text: "Doe · delete",
      occurrence: "2 of 2",
    });
  });

  it("gives a table cell its row label and column header", () => {
    const table = parseOutline(
      [
        "[0-1] table",
        "  [0-2] row",
        "    [0-3] columnheader: Model",
        "    [0-4] columnheader: Scalability",
        "  [0-5] row",
        "    [0-6] cell: GPT-4",
        "    [0-7] cell: Highly scalable",
        "  [0-8] row",
        "    [0-9] cell: Gemini (Google)",
        "    [0-10] cell: Scalable architecture with API access",
      ].join("\n"),
    );
    expect(describeCandidate(table, table[9]!)).toMatchObject({
      table: { row: "Gemini (Google)", column: "Scalability" },
    });
    const scores = scoreCandidates(
      table,
      [table[6]!, table[9]!],
      "the scalability comment for Gemini (Google)",
    );
    expect(scores.get("0-10")!).toBeGreaterThan(scores.get("0-7")!);
  });

  it("digests the page for state questions", () => {
    expect(pageDigest(parseOutline(PAGE))).toMatchObject({ title: "Shop", inputs: 0 });
  });
});

describe("jev act argument helpers", () => {
  it("does not read apostrophes as quotes", () => {
    expect(fillValueCandidates("fill the user's name 'John' into the form")).toEqual(["John"]);
  });

  it("types the user's literal characters, not the model's re-cased copy", () => {
    expect(groundedSpan("abc123", "type AbC123 into the password field")).toBe("AbC123");
    expect(groundedSpan("hello   world", "enter Hello world in the box")).toBe("Hello world");
    expect(groundedSpan("AbC123", "type AbC123 into the password field")).toBe("AbC123");
    expect(groundedSpan("abc124", "type AbC123 into the password field")).toBeUndefined();
  });

  it("only accepts extracted text that is lifted from the instruction or a declared variable", () => {
    expect(isGroundedText("Linear  Algebra", "search for linear algebra")).toBe(true);
    expect(isGroundedText("calculus", "search for linear algebra")).toBe(false);
    expect(isGroundedText("%pw%", "type the password", { pw: "x" })).toBe(true);
    expect(isGroundedText("%other%", "type the password", { pw: "x" })).toBe(false);
  });

  it("never matches an option that merely repeats the control's name", () => {
    const options = ["Select a Country", "United States", "Canada"];
    expect(
      matchOption(
        options,
        "choose 'Canada' from the 'Select a Country' dropdown",
        "Select a Country",
      ),
    ).toBe("Canada");
    expect(
      matchOption(options, "pick the northern one in 'Select a Country'", "Select a Country"),
    ).toBeUndefined();
    // Unquoted mentions go to Jev: short options occur in instructions as ordinary words.
    expect(
      matchOption(["In", "Out"], "choose Out in the direction dropdown", "Direction"),
    ).toBeUndefined();
  });
});

describe("jev page state", () => {
  it("reads every signal in one request and names the blocking one", async () => {
    const bodies = stubNouls({ captcha: 0.95, cookie_banner: 0.8 });
    const state = await readPageState(context(), parseOutline(PAGE), "https://example.com");

    expect(bodies).toHaveLength(1);
    expect(state).toMatchObject({ captcha: 0.95, cookie_banner: 0.8, access_denied: 0.02 });
    expect(blockingSignal(state)).toBe("captcha");
    expect(blockingSignal({ ...state, captcha: 0.5 })).toBeUndefined();
  });
});
