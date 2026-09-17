import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import {
  fillValueCandidates,
  groundedSpan,
  isGroundedText,
  matchOption,
  parsePercent,
  redactor,
  redactDeep,
} from "../services/jevAct/args.js";
import { blockingSignal, readPageState } from "../services/jevAct/pageState.js";
import type { AskContext } from "../services/jevAct/pick.js";
import { systemOne } from "../services/jevAct/typesafeClient.js";
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

describe("redactor", () => {
  it("replaces resolved variable values, including their JSON-escaped form, longest first", () => {
    const redact = redactor({ password: 'p"ss/w0rd', user: "alice@example.com", pin: "12" })!;
    expect(redact('typed alice@example.com then p"ss/w0rd')).toBe("typed %user% then %password%");
    // Values already JSON-encoded inside a serialised request are caught too.
    expect(redact(JSON.stringify({ text: 'p"ss/w0rd' }))).toBe('{"text":"%password%"}');
    // Keys of the request stay intact; only values move.
    expect(redact('{"instructions":"alice@example.com"}')).toBe('{"instructions":"%user%"}');
  });

  it("leaves values under three characters alone, on purpose", () => {
    const redact = redactor({ pin: "12", long: "secret-value" })!;
    expect(redact("code 12 and secret-value")).toBe("code 12 and %long%");
    expect(redactor({ only: "ab" })).toBeUndefined();
  });
});

describe("argument parsing edge cases", () => {
  it("accepts the fractional scroll form", () => {
    expect(parsePercent("scroll to 0.75")).toBe("75%");
    expect(parsePercent("scroll down 75%")).toBe("75%");
    expect(parsePercent("click item 1.5 in the list")).toBeUndefined();
    // Counts and ordinals are not fractions.
    expect(parsePercent("scroll down 1 screen")).toBeUndefined();
    expect(parsePercent("scroll to the 1st result")).toBeUndefined();
    expect(parsePercent("scroll to .5")).toBe("50%");
  });

  it("only treats declared own-property variables as placeholders", () => {
    expect(fillValueCandidates("type %toString% here", {})).toEqual([]);
    expect(groundedSpan("%constructor%", "type %constructor%", {})).toBeUndefined();
    expect(groundedSpan("%name%", "type %name%", { name: "x" })).toBe("%name%");
  });
});

describe("typesafe client errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the timeout budget and rejects a malformed success payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("aborted");
        error.name = "TimeoutError";
        throw error;
      }),
    );
    await expect(systemOne({ apiKey: `k-${Math.random()}` }, {}, {})).rejects.toThrow(
      /timed out after \d+ ms/,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })),
    );
    await expect(systemOne({ apiKey: `k-${Math.random()}` }, {}, {})).rejects.toThrow(
      /not a systemone payload/,
    );
  });

  it("does not let a terminal 4xx keep counting toward the outage breaker", async () => {
    const statuses = [500, 400, 500, 500];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: statuses.shift() ?? 200 })),
    );
    const config = { apiKey: `k-${Math.random()}` };
    for (let i = 0; i < 4; i++) await systemOne(config, {}, {}).catch(() => undefined);
    // Failures were 500, 400 (reset), 500, 500: two consecutive outage failures,
    // not three, so the breaker is still closed and the next call is attempted.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ answers: {} }), { status: 200 })),
    );
    await expect(systemOne(config, {}, {})).resolves.toMatchObject({ answers: {} });
  });
});

describe("typesafe client breakers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the auth breaker on a 401 and rejects the next call while it is open", async () => {
    const config = { apiKey: `k-${Math.random()}` };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    await expect(systemOne(config, {}, {})).rejects.toThrow(/401/);
    const fetchAfter = vi.fn(
      async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchAfter);
    await expect(systemOne(config, {}, {})).rejects.toThrow(/paused/);
    expect(fetchAfter).not.toHaveBeenCalled();
  });

  it("opens the outage breaker after three consecutive failures, malformed payloads included", async () => {
    const config = { apiKey: `k-${Math.random()}` };
    const bodies = ["{}", "<html>gateway</html>", "{}"];
    const statuses = [500, 200, 500];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bodies.shift() ?? "{}", { status: statuses.shift() ?? 500 })),
    );
    for (let i = 0; i < 3; i++) await systemOne(config, {}, {}).catch(() => undefined);
    const fetchAfter = vi.fn(
      async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchAfter);
    await expect(systemOne(config, {}, {})).rejects.toThrow(/paused/);
    expect(fetchAfter).not.toHaveBeenCalled();
  });
});

describe("typesafe client breaker recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes again once the outage window has passed and a success resets the counter", async () => {
    const config = { apiKey: `k-${Math.random()}` };
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    for (let i = 0; i < 3; i++) await systemOne(config, {}, {}).catch(() => undefined);
    await expect(systemOne(config, {}, {})).rejects.toThrow(/paused/);

    // 30 s later the breaker lets a request through again.
    now += 30_001;
    const ok = vi.fn(async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }));
    vi.stubGlobal("fetch", ok);
    await expect(systemOne(config, {}, {})).resolves.toMatchObject({ answers: {} });
    expect(ok).toHaveBeenCalledTimes(1);

    // The success reset the counter: two failures do not re-open it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    for (let i = 0; i < 2; i++) await systemOne(config, {}, {}).catch(() => undefined);
    vi.stubGlobal("fetch", ok);
    await expect(systemOne(config, {}, {})).resolves.toMatchObject({ answers: {} });
  });
});

describe("redactDeep", () => {
  it("redacts string values only, so awkward values cannot corrupt the request", () => {
    const redact = redactor({ pw: 'Secr3t"', s: "state", n: "name" })!;
    const request = {
      state: { instruction: 'type Secr3t" into name', name: "state" },
      questions: { best: { type: "choice", criteria: { "0-1": { name: 'Secr3t"' } } } },
    };
    const out = redactDeep(request, redact);
    // Keys survive; every value is redacted; JSON stays valid.
    expect(Object.keys(out)).toEqual(["state", "questions"]);
    expect(out.state).toEqual({ instruction: "type %pw% into %n%", name: "%s%" });
    expect(out.questions.best.criteria["0-1"]).toEqual({ name: "%pw%" });
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });
});
