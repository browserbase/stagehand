import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { runJevObserve, type JevObserveDeps } from "../services/jevAct/observe.js";

const PAGE = [
  "[0-1] RootWebArea: Sign up",
  "  [0-2] heading: Create your account",
  "  [0-3] textbox: Email",
  "  [0-4] textbox: Password",
  "  [0-5] select: Country",
  "    [0-6] option: Canada",
  "    [0-7] option: Peru",
  "  [0-8] button: Sign up",
  "  [0-9] link: Terms",
].join("\n");
const XPATHS = Object.fromEntries([2, 3, 4, 5, 8, 9].map((n) => [`0-${n}`, `/html/body/*[${n}]`]));

function deps(instruction?: string): JevObserveDeps {
  return {
    page: {
      captureSnapshot: vi.fn(async () => ({
        combinedTree: PAGE,
        combinedXpathMap: XPATHS,
        combinedUrlMap: {},
      })),
    } as never,
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-observe-test") }, () => {}),
    instruction,
    snapshotOptions: {},
    ensureTimeRemaining: () => {},
  };
}

function stub(answer: (key: string, question: { criteria?: Record<string, unknown> }) => unknown) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      questions: Record<string, { criteria?: Record<string, unknown> }>;
    };
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([key, q]) => [key, answer(key, q)]),
    );
    return new Response(
      JSON.stringify({ model: "jev", answers, usage: { input_tokens: 1, output_tokens: 1 } }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const choice = (value: string, confidence = 0.95) => ({
  type: "choice",
  choice: value,
  confidence,
  probabilities: { [value]: confidence },
});

afterEach(() => vi.unstubAllGlobals());

describe("jev observe", () => {
  it("lists every interactive element without a model when there is no instruction", async () => {
    const fetchMock = stub(() => choice("unused"));
    const outcome = await runJevObserve({ apiKey: "test" }, deps());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      outcome.kind === "done" &&
        outcome.actions.map((action) => [action.description, action.method]),
    ).toEqual([
      ["textbox: Email", "fill"],
      ["textbox: Password", "fill"],
      ["button: Sign up", "click"],
      ["link: Terms", "click"],
    ]);
  });

  it("asks one yes/no per candidate for 'find all' instructions", async () => {
    const fetchMock = stub((key, question) =>
      key === "family"
        ? choice("fill")
        : key === "cardinality"
          ? choice("several")
          : key === "key"
            ? choice("other")
            : { type: "noul", noul: ["0-3", "0-4"].includes(key) ? 0.93 : 0.05, question },
    );
    const outcome = await runJevObserve(
      { apiKey: "test" },
      deps("find all the text fields in the form"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.kind === "done" && outcome.actions.map((action) => action.selector)).toEqual([
      "xpath=/html/body/*[3]",
      "xpath=/html/body/*[4]",
    ]);
  });

  it("picks one element and carries method and arguments from the instruction", async () => {
    stub((key, question) =>
      key === "family"
        ? choice("select")
        : key === "cardinality"
          ? choice("one")
          : key === "key"
            ? choice("other")
            : question.criteria
              ? choice("0-5")
              : { type: "noul", noul: 0.95 },
    );
    const outcome = await runJevObserve(
      { apiKey: "test" },
      deps("choose 'Peru' in the country dropdown"),
    );

    expect(outcome).toMatchObject({
      kind: "done",
      actions: [
        {
          selector: "xpath=/html/body/*[5]",
          method: "selectOptionFromDropdown",
          arguments: ["Peru"],
        },
      ],
    });
  });

  it("never sends a bound variable's value that is already on the page", async () => {
    const page = [
      "[0-1] textbox: API token",
      "  [0-2] StaticText: FAKE_BOUND_SECRET",
      "[0-3] button: Save token",
    ].join("\n");
    const fetchMock = stub((key, question) =>
      key === "family"
        ? choice("click")
        : key === "cardinality"
          ? choice("one")
          : key === "key"
            ? choice("other")
            : question.criteria
              ? choice("0-3")
              : { type: "noul", noul: 0.95 },
    );
    const harness = deps("click save");
    harness.variables = { token: "FAKE_BOUND_SECRET" };
    (harness.page.captureSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      combinedTree: page,
      combinedXpathMap: { "0-1": "/html/body/input", "0-3": "/html/body/button" },
      combinedUrlMap: {},
    });

    expect((await runJevObserve({ apiKey: "test" }, harness)).kind).toBe("done");
    expect(
      JSON.stringify(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).body)),
    ).not.toContain("FAKE_BOUND_SECRET");
  });

  it("lets explicit intent decide the method on a native select", async () => {
    stub((key, question) =>
      key === "family"
        ? choice("hover")
        : key === "cardinality"
          ? choice("one")
          : key === "key"
            ? choice("other")
            : question.criteria
              ? choice("0-5")
              : { type: "noul", noul: 0.95 },
    );
    expect(
      await runJevObserve({ apiKey: "test" }, deps("hover over the Country dropdown")),
    ).toMatchObject({
      kind: "done",
      actions: [{ selector: "xpath=/html/body/*[5]", method: "hover", arguments: [] }],
    });
  });

  it("answers 'find all' exhaustively or not at all", async () => {
    const many = (count: number) => ({
      combinedTree: Array.from(
        { length: count },
        (_, i) => `[0-${i + 1}] button: Buy ${i + 1}`,
      ).join("\n"),
      combinedXpathMap: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`0-${i + 1}`, `/b[${i + 1}]`]),
      ),
      combinedUrlMap: {},
    });
    const answer = (key: string) =>
      key === "family"
        ? choice("click")
        : key === "cardinality"
          ? choice("several")
          : key === "key"
            ? choice("other")
            : { type: "noul", noul: 1 };

    stub(answer);
    const all = deps("find all the buy buttons");
    (all.page.captureSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(many(181));
    const outcome = await runJevObserve({ apiKey: "test" }, all);
    expect(outcome.kind === "done" && outcome.actions).toHaveLength(181);

    stub(answer);
    const tooMany = deps("find all the buy buttons");
    (tooMany.page.captureSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(many(601));
    expect(await runJevObserve({ apiKey: "test" }, tooMany)).toMatchObject({
      kind: "fallback",
      reason: "too_many_candidates:601",
    });

    const everything = deps();
    (everything.page.captureSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(many(401));
    expect(await runJevObserve({ apiKey: "test" }, everything)).toMatchObject({ kind: "fallback" });
  });

  it("hands locate-nothing and low-confidence intents to the LLM", async () => {
    stub((key) => (key === "family" ? choice("click", 0.3) : choice("one")));
    expect(await runJevObserve({ apiKey: "test" }, deps("hmm"))).toMatchObject({
      kind: "fallback",
    });
  });
});
