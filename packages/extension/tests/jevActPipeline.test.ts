import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, ActResultData } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../logger.js";
import {
  fillValueCandidates,
  parseKey,
  parsePercent,
  runJevActPipeline,
  type JevActDeps,
  resolveFamily,
} from "../services/jevAct/pipeline.js";
import { resolveLocatorWithHops } from "../understudy/deepLocator.js";
import type { Page } from "../understudy/page.js";

vi.mock("../understudy/deepLocator.js", () => ({
  resolveLocatorWithHops: vi.fn(async () => ({ inputValue: async () => "business" })),
}));

const FORM = [
  "[0-1] RootWebArea: Login",
  "  [0-2] form: Login",
  "    [0-4] LabelText: Username",
  "    [0-5] textbox: Username",
  "    [0-7] select: Favourite colour",
  "      [0-8] MenuListPopup",
  "        [0-9] option: Red [selected]",
  "        [0-10] option: Green",
].join("\n");

type Answers = Record<string, unknown>;

function choice(value: string, confidence = 0.95) {
  return { type: "choice", choice: value, confidence, probabilities: { [value]: confidence } };
}

function noul(value: number) {
  return { type: "noul", noul: value };
}

/** `best` is a Noul for a lone candidate and a Choice otherwise. */
function best(id: string, confidence = 0.95) {
  return (question: { criteria?: Record<string, unknown> }) =>
    question.criteria ? choice(id, confidence) : noul(confidence);
}

const DEFAULT_ANSWERS: Record<string, unknown> = {
  mouse_button: choice("left"),
  fill_value: choice("value_0"),
  scroll_scope: choice("not_scroll"),
  toggle_state: choice("unspecified"),
  after_typing: choice("nothing"),
  key: choice("other"),
  // page-state signals default to "nothing unusual"
  access_denied: noul(0.02),
  captcha: noul(0.02),
  login_wall: noul(0.02),
  cookie_banner: noul(0.02),
  error_page: noul(0.02),
  empty_or_loading: noul(0.02),
};

/** Answers keyed by question name; a function receives the question for per-request answers. */
type Answer = unknown | ((question: { criteria?: Record<string, unknown> }) => unknown);

function stubJev(table: Answers) {
  const calls: Array<{ state: unknown; questions: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        state: unknown;
        questions: Record<string, unknown>;
      };
      calls.push(body);
      const answers = Object.fromEntries(
        Object.entries(body.questions).map(([key, question]) => {
          const answer = (table[key] ?? DEFAULT_ANSWERS[key]) as Answer;
          return [
            key,
            typeof answer === "function"
              ? answer(question)
              : (answer ?? { type: "noul", noul: 0.9 }),
          ];
        }),
      );
      return new Response(
        JSON.stringify({
          model: "jev-latest",
          answers,
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
        { status: 200 },
      );
    }),
  );
  return calls;
}

function deps(tree: string, xpathMap: Record<string, string>, overrides: Partial<JevActDeps> = {}) {
  const captureSnapshot = vi.fn(async () => ({
    combinedTree: tree,
    combinedXpathMap: xpathMap,
    combinedUrlMap: {},
  }));
  const takeAction = vi.fn(
    async (action: Action): Promise<ActResultData> => ({
      success: true,
      message: "ok",
      actionDescription: action.description,
      actions: [action],
    }),
  );
  const value: JevActDeps = {
    page: {
      captureSnapshot,
      mainFrame: () => ({}),
      url: () => "https://example.com",
    } as unknown as Page,
    logger: new StagehandLogger({ tracer: trace.getTracer("jev-act-test") }, () => {}),
    instruction: "",
    snapshotOptions: {},
    ensureTimeRemaining: () => {},
    takeAction,
    ...overrides,
  };
  return { value, captureSnapshot, takeAction };
}

const config = { apiKey: "test" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jev act pipeline", () => {
  it("fills a variable placeholder into the chosen field and verifies by read-back", async () => {
    const calls = stubJev({
      family: choice("fill"),
      key: choice("other"),
      strict: choice("0-5"),
      best: best("0-5"),
    });
    const { value, takeAction } = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      {
        instruction: "type %nunya% into the username field",
        variables: { nunya: "business" },
      },
    );

    const outcome = await runJevActPipeline(config, value);

    expect(outcome.kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith({
      selector: "xpath=/html/body/form/input",
      description: "textbox: Username",
      method: "fill",
      arguments: ["%nunya%"],
    });
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[1]!.questions)).toEqual(["strict", "best"]);
  });

  it("falls back without a snapshot when intent confidence is low", async () => {
    stubJev({ family: choice("click", 0.4), key: choice("other") });
    const { value, captureSnapshot, takeAction } = deps(FORM, {}, { instruction: "do the thing" });

    const outcome = await runJevActPipeline(config, value);

    expect(outcome).toMatchObject({
      kind: "fallback",
      reason: expect.stringContaining("intent_low_confidence:click"),
    });
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(takeAction).not.toHaveBeenCalled();
  });

  it("presses a key without capturing a snapshot", async () => {
    stubJev({ family: choice("press"), key: choice("Enter") });
    const { value, captureSnapshot, takeAction } = deps(FORM, {}, { instruction: "press enter" });

    const outcome = await runJevActPipeline(config, value);

    expect(outcome.kind).toBe("done");
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ method: "press", arguments: ["Enter"] }),
    );
  });

  it("selects a quoted native option deterministically", async () => {
    const calls = stubJev({
      family: choice("select"),
      key: choice("other"),
      strict: choice("0-7"),
      best: best("0-7"),
    });
    const { value, takeAction } = deps(
      FORM,
      { "0-7": "/html/body/form/select" },
      {
        instruction: "select 'Green' from the favourite colour dropdown",
      },
    );

    // Read-back needs a changed snapshot; the static fixture cannot provide one.
    const outcome = await runJevActPipeline({ ...config, verify: "off" as const }, value);

    expect(outcome.kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ method: "selectOptionFromDropdown", arguments: ["Green"] }),
    );
    expect(calls.map((call) => Object.keys(call.questions))).toEqual([
      expect.arrayContaining(["family", "scroll_scope", "key", "mouse_button"]),
      ["strict", "best"],
    ]);
  });

  it("accepts the best pick when strict hedges toward none, and vetoes when strict is certain", async () => {
    const hedged = {
      type: "choice",
      choice: "none_match",
      confidence: 0.55,
      probabilities: { none_match: 0.6, "0-5": 0.4 },
    };
    stubJev({
      family: choice("fill"),
      key: choice("other"),
      strict: hedged,
      best: best("0-5", 0.85),
    });
    const loose = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      { instruction: "type 'business' into the input" },
    );
    expect((await runJevActPipeline(config, loose.value)).kind).toBe("done");

    const certain = { ...hedged, confidence: 0.99, probabilities: { none_match: 1, "0-5": 0 } };
    stubJev({
      family: choice("fill"),
      key: choice("other"),
      strict: certain,
      best: best("0-5", 0.85),
    });
    const absent = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      { instruction: "type 'business' into the fax field" },
    );
    const outcome = await runJevActPipeline(config, absent.value);
    expect(outcome.kind).toBe("fallback");
    expect(absent.takeAction).not.toHaveBeenCalled();
  });

  it("falls to the broad view when no semantic control exists", async () => {
    const tree = [
      "[0-1] RootWebArea: Demo",
      "  [0-2] generic",
      "    [0-3] StaticText: Select a country",
    ].join("\n");
    stubJev({
      family: choice("click"),
      key: choice("other"),
      strict: choice("0-3"),
      best: best("unused", 0.9),
    });
    const { value, takeAction } = deps(
      tree,
      { "0-3": "/html/body/div/div/text()" },
      {
        instruction: "click to expand the 'Select a country' dropdown",
      },
    );

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html/body/div/div", method: "click" }),
    );
  });

  it("resolves whole-page scrolls to the main document without a target question", async () => {
    const tree = [
      "[0-1] RootWebArea: Demo",
      "  [0-2] scrollable, html",
      "    [0-3] Iframe",
      "      [1-1] RootWebArea: Inner",
      "        [1-2] scrollable, html",
    ].join("\n");
    const calls = stubJev({
      family: choice("scroll"),
      key: choice("other"),
      scroll_scope: choice("whole_page"),
    });
    const { value, takeAction } = deps(
      tree,
      { "0-2": "/html", "1-2": "/html/body/iframe/html" },
      {
        instruction: "Scroll 75% down the page",
      },
    );

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html", method: "scrollTo", arguments: ["75%"] }),
    );
    expect(calls).toHaveLength(1);
  });

  it("falls back when the only quoted string is the field's label, not the value", async () => {
    stubJev({ family: choice("fill"), fill_value: choice("none_match", 0.99) });
    const { value, captureSnapshot, takeAction } = deps(
      FORM,
      {},
      {
        instruction: "type John into the 'Username' field",
      },
    );

    const outcome = await runJevActPipeline(config, value);

    expect(outcome).toMatchObject({ kind: "fallback", reason: "fill_no_value" });
    expect(captureSnapshot).not.toHaveBeenCalled();
    expect(takeAction).not.toHaveBeenCalled();
  });

  it("asks Jev for the option when the quoted text names the dropdown placeholder", async () => {
    const tree = [
      "[0-1] select: Select a Country",
      "  [0-2] option: Select a Country [selected]",
      "  [0-3] option: United States",
      "  [0-4] option: Canada",
    ].join("\n");
    stubJev({
      family: choice("select"),
      strict: choice("0-1"),
      best: best("unused", 0.95),
      option: choice("option_2"),
    });
    const { value, takeAction } = deps(
      tree,
      { "0-1": "/html/body/select" },
      {
        instruction: "choose the northern one from the 'Select a Country' dropdown",
      },
    );

    await runJevActPipeline({ ...config, verify: "off" as const }, value);

    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ method: "selectOptionFromDropdown", arguments: ["Canada"] }),
    );
  });

  it("clicks once when the select target is itself a choice, and keeps the expand click on fallback", async () => {
    const radio = ["[0-1] radiogroup: Contact", "  [0-2] radio: Phone"].join("\n");
    stubJev({ family: choice("select"), strict: choice("0-2"), best: best("unused", 0.95) });
    const leaf = deps(
      radio,
      { "0-2": "/html/body/input" },
      { instruction: "select phone as the contact method" },
    );
    expect((await runJevActPipeline(config, leaf.value)).kind).toBe("done");
    expect(leaf.takeAction).toHaveBeenCalledTimes(1);

    const custom = ["[0-1] div", "  [0-3] StaticText: Select a country"].join("\n");
    const opened = [custom, "  [0-4] listitem: Mexico", "  [0-5] listitem: Peru"].join("\n");
    stubJev({
      family: choice("select"),
      // The trigger is accepted; none of the options that open is Canada.
      strict: (question: { criteria?: Record<string, unknown> }) =>
        choice("0-3" in (question.criteria ?? {}) ? "0-3" : "none_match", 0.99),
      best: (question: { criteria?: Record<string, unknown> }) =>
        question.criteria ? choice("0-4", 0.3) : noul(0.95),
    });
    const expandOnly = deps(
      custom,
      { "0-3": "/html/body/div/div/text()" },
      {
        instruction: "choose Canada from the 'Select a country' dropdown",
      },
    );
    expandOnly.captureSnapshot
      .mockResolvedValueOnce({
        combinedTree: custom,
        combinedXpathMap: { "0-3": "/html/body/div/div/text()" },
        combinedUrlMap: {},
      })
      .mockResolvedValue({
        combinedTree: opened,
        combinedXpathMap: { "0-3": "/html/body/div/div/text()", "0-4": "/li[1]", "0-5": "/li[2]" },
        combinedUrlMap: {},
      });
    const outcome = await runJevActPipeline(config, expandOnly.value);
    expect(outcome).toMatchObject({
      kind: "fallback",
      priorActions: [expect.objectContaining({ method: "click" })],
    });

    // Nothing opens after clicking something that should have opened a list:
    // the option was not chosen, so the LLM path continues from the click.
    stubJev({ family: choice("select"), strict: choice("0-3"), best: noul(0.95) });
    const stuck = deps(
      custom,
      { "0-3": "/html/body/div/div/text()" },
      { instruction: "choose Canada in the country list" },
    );
    expect(await runJevActPipeline(config, stuck.value)).toMatchObject({
      kind: "fallback",
      reason: "option_none_appeared",
      priorActions: [expect.objectContaining({ method: "click" })],
    });

    // A calendar day is the choice itself: one click, done.
    const calendar = ["[0-1] grid: March", "  [0-2] gridcell: 15"].join("\n");
    stubJev({ family: choice("select"), strict: choice("0-2"), best: best("0-2") });
    const day = deps(
      calendar,
      { "0-2": "/html/body/table/td" },
      { instruction: "pick the 15th in the calendar" },
    );
    expect((await runJevActPipeline(config, day.value)).kind).toBe("done");
  });

  it("sends modifier chords and unsure mouse buttons to the LLM", async () => {
    stubJev({ family: choice("press") });
    const chord = deps(FORM, {}, { instruction: "press ctrl+a" });
    expect(await runJevActPipeline(config, chord.value)).toEqual({
      kind: "fallback",
      reason: "modifier_chord",
    });

    const right = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      { instruction: "right click the username box" },
    );
    stubJev({
      family: choice("click"),
      mouse_button: choice("right"),
      strict: choice("0-5"),
      best: best("0-5", 0.9),
    });
    await runJevActPipeline(config, right.value);
    expect(right.takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ method: "click", arguments: ["right"] }),
    );
  });

  it("never sends a resolved variable value to TypeSafe, even once it is on the page", async () => {
    const tree = [
      "[0-1] textbox: Password",
      "  [0-2] StaticText: hunter2-secret",
      "[0-3] button: Sign in",
      "[0-4] button: Sign up",
    ].join("\n");
    const calls = stubJev({ family: choice("click"), strict: choice("0-3"), best: best("0-3") });
    const { value } = deps(
      tree,
      { "0-3": "/html/body/button[1]" },
      {
        instruction: "click sign in",
        variables: { pw: "hunter2-secret" },
      },
    );

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(JSON.stringify(calls)).not.toContain("hunter2-secret");
  });

  it("offers a contenteditable paragraph as a fill target", async () => {
    const tree = [
      "[0-1] textbox: Code",
      "[0-2] paragraph",
      "  [0-3] StaticText: Editable note",
    ].join("\n");
    const calls = stubJev({ family: choice("fill"), strict: choice("0-2"), best: best("0-2") });
    const harness = deps(
      tree,
      { "0-1": "/html/body/textarea", "0-2": "/html/body/p" },
      {
        instruction: "replace the editable paragraph with 'Moved to Thursday'",
      },
    );
    harness.captureSnapshot.mockResolvedValue({
      combinedTree: tree,
      combinedXpathMap: { "0-1": "/html/body/textarea", "0-2": "/html/body/p" },
      combinedUrlMap: {},
      combinedEditableIds: ["0-1", "0-2", "0-3"],
    } as never);
    vi.mocked(resolveLocatorWithHops).mockResolvedValueOnce({
      inputValue: async () => "Moved to Thursday",
    } as never);

    expect((await runJevActPipeline(config, harness.value)).kind).toBe("done");
    expect(Object.keys((calls[1]!.questions.strict as { criteria: object }).criteria)).toEqual([
      "0-1",
      "0-2",
      "none_match",
    ]);
    expect(harness.takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html/body/p", method: "fill" }),
    );
  });

  it("keeps an action that already ran when Jev errors afterwards", async () => {
    const custom = ["[0-1] div", "  [0-3] StaticText: Select a country"].join("\n");
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests++;
        if (requests >= 3) return new Response("{}", { status: 500 });
        const questions = Object.keys(JSON.parse(init.body as string).questions);
        const answers = Object.fromEntries(
          questions.map((key) => [
            key,
            key === "best"
              ? noul(0.95)
              : key === "family"
                ? choice("select")
                : key === "strict"
                  ? choice("0-3")
                  : (DEFAULT_ANSWERS[key] ?? choice("x")),
          ]),
        );
        return new Response(
          JSON.stringify({ model: "jev", answers, usage: { input_tokens: 1, output_tokens: 1 } }),
        );
      }),
    );
    const harness = deps(
      custom,
      { "0-3": "/html/body/div/div/text()" },
      { instruction: "choose Canada from the country dropdown" },
    );
    harness.captureSnapshot
      .mockResolvedValueOnce({
        combinedTree: custom,
        combinedXpathMap: { "0-3": "/x/text()" },
        combinedUrlMap: {},
      })
      .mockResolvedValue({
        combinedTree: `${custom}\n  [0-4] option: Canada`,
        combinedXpathMap: { "0-3": "/x/text()", "0-4": "/li" },
        combinedUrlMap: {},
      });

    expect(await runJevActPipeline(config, harness.value)).toMatchObject({
      kind: "fallback",
      reason: expect.stringContaining("jev_error"),
      priorActions: [expect.objectContaining({ method: "click" })],
    });
  });

  it("answers not-an-action without a snapshot or an LLM fallback", async () => {
    stubJev({ family: choice("not_an_action", 1), key: choice("other") });
    const { value, captureSnapshot } = deps(
      FORM,
      {},
      { instruction: "what is the capital of the moon?" },
    );

    const outcome = await runJevActPipeline(config, value);

    expect(outcome).toMatchObject({ kind: "done", result: { success: false, actions: [] } });
    expect(captureSnapshot).not.toHaveBeenCalled();
  });

  const MANY = Array.from(
    { length: 300 },
    (_, index) => `[0-${index + 1}] button: Item ${index + 1}`,
  ).join("\n");
  const MANY_XPATHS = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => [
      `0-${index + 1}`,
      `/html/body/button[${index + 1}]`,
    ]),
  );

  it("prunes a large view to lexical matches so the pick is one request", async () => {
    const calls = stubJev({
      family: choice("click"),
      strict: choice("0-280"),
      best: best("0-280"),
    });
    const { value, takeAction } = deps(MANY, MANY_XPATHS, { instruction: "click item 280" });

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html/body/button[280]", method: "click" }),
    );
    expect(calls).toHaveLength(2);
    const offered = Object.keys((calls[1]!.questions.strict as { criteria: object }).criteria);
    expect(offered).toContain("0-280");
    expect(offered.length).toBeLessThanOrEqual(31);
  });

  it("shards the full view when nothing matches lexically, then picks among finalists", async () => {
    const calls = stubJev({
      family: choice("click"),
      shard: (question: { criteria?: Record<string, unknown> }) =>
        choice("0-280" in (question.criteria ?? {}) ? "0-280" : "0-3", 0.6),
      strict: choice("0-280"),
      best: best("0-280"),
    });
    const { value, takeAction } = deps(MANY, MANY_XPATHS, {
      instruction: "click the penultimate widget",
    });

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html/body/button[280]" }),
    );
    expect(calls.slice(1).map((call) => Object.keys(call.questions))).toEqual([
      ["shard"],
      ["shard"],
      ["strict", "best"],
    ]);
  });

  it("only confirms, not ranks, when exactly one candidate carries the quoted name", async () => {
    const calls = stubJev({ family: choice("click"), strict: choice("0-17"), best: noul(0.95) });
    const { value, takeAction } = deps(MANY, MANY_XPATHS, {
      instruction: "click the 'Item 17' button",
    });

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html/body/button[17]" }),
    );
    expect(calls).toHaveLength(2);
    expect(Object.keys((calls[1]!.questions.strict as { criteria: object }).criteria)).toEqual([
      "0-17",
      "none_match",
    ]);

    // The quote was only an anchor: Jev says no, and the normal pick runs.
    stubJev({
      family: choice("click"),
      strict: (question: { criteria?: Record<string, unknown> }) =>
        "0-18" in (question.criteria ?? {}) ? choice("0-18") : choice("none_match", 0.99),
      best: (question: { criteria?: Record<string, unknown> }) =>
        question.criteria
          ? choice("0-18")
          : noul(JSON.stringify(question).includes("Item 18") ? 0.95 : 0.1),
      shard: (question: { criteria?: Record<string, unknown> }) =>
        choice("0-18" in (question.criteria ?? {}) ? "0-18" : "none_match", 0.6),
    });
    const anchored = deps(MANY, MANY_XPATHS, {
      instruction: "click the button right after 'Item 17'",
    });
    const anchoredOutcome = await runJevActPipeline(config, anchored.value).catch(
      (error: unknown) => error,
    );
    expect(anchoredOutcome).toMatchObject({ kind: "done" });
    expect(anchored.takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "xpath=/html/body/button[18]" }),
    );
  });

  it("leaves an already-checked box alone when the instruction asks for checked", async () => {
    const tree = ["[0-1] checkbox: Subscribe [checked]", "[0-2] checkbox: Terms"].join("\n");
    stubJev({
      family: choice("click"),
      toggle_state: choice("on"),
      strict: choice("0-1"),
      best: best("0-1"),
    });
    const { value, takeAction } = deps(
      tree,
      { "0-1": "/html/body/input[1]" },
      {
        instruction: "make sure Subscribe is checked",
      },
    );

    const outcome = await runJevActPipeline(config, value);

    expect(outcome).toMatchObject({ kind: "done", result: { success: true, actions: [] } });
    expect(takeAction).not.toHaveBeenCalled();
  });

  it("uses the argument-only LLM for unquoted text while Jev picks the field", async () => {
    stubJev({ family: choice("fill"), strict: choice("0-5"), best: best("0-5") });
    const extractText = vi.fn(async () => "linear algebra");
    const { value, takeAction } = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      {
        instruction: "search for linear algebra in the username box",
        extractText,
      },
    );
    vi.mocked(resolveLocatorWithHops).mockResolvedValueOnce({
      inputValue: async () => "linear algebra",
    } as never);

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({ method: "fill", arguments: ["linear algebra"] }),
    );

    // With the argument LLM switched off the run is LLM-free: the helper is never called.
    stubJev({ family: choice("fill"), strict: choice("0-5"), best: best("0-5") });
    const spy = vi.fn(async () => "business");
    const pure = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      {
        instruction: "type business into the username field",
        extractText: spy,
      },
    );
    expect(await runJevActPipeline({ ...config, argumentLlm: false }, pure.value)).toMatchObject({
      kind: "fallback",
      reason: "fill_no_value",
    });
    expect(spy).not.toHaveBeenCalled();

    // Invented text is rejected: it must be lifted from the instruction.
    stubJev({ family: choice("fill"), strict: choice("0-5"), best: best("0-5") });
    const invented = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      {
        instruction: "search for linear algebra",
        extractText: vi.fn(async () => "calculus"),
      },
    );
    expect(await runJevActPipeline(config, invented.value)).toMatchObject({
      kind: "fallback",
      reason: "fill_value_not_extracted",
    });
  });

  it("picks the suggestion that typing made appear", async () => {
    const before = ["[0-1] combobox: State"].join("\n");
    const after = [
      "[0-1] combobox: State",
      "  [0-2] listbox",
      "    [0-3] option: Alabama",
      "    [0-4] option: Alaska",
    ].join("\n");
    const prefer = (question: { criteria?: Record<string, unknown> }) =>
      question.criteria ? choice("0-4" in question.criteria ? "0-4" : "0-1") : noul(0.95);
    stubJev({
      family: choice("fill"),
      after_typing: choice("pick_suggestion"),
      strict: prefer,
      best: prefer,
    });
    const harness = deps(
      before,
      { "0-1": "/html/body/input", "0-4": "/html/body/ul/li[2]" },
      {
        instruction: "type 'Ala' into the State box and pick the suggestion 'Alaska'",
      },
    );
    harness.captureSnapshot
      .mockResolvedValueOnce({
        combinedTree: before,
        combinedXpathMap: { "0-1": "/html/body/input" },
        combinedUrlMap: {},
      })
      .mockResolvedValue({
        combinedTree: after,
        combinedXpathMap: { "0-1": "/html/body/input", "0-4": "/html/body/ul/li[2]" },
        combinedUrlMap: {},
      });
    vi.mocked(resolveLocatorWithHops).mockResolvedValueOnce({
      inputValue: async () => "Ala",
    } as never);

    const outcome = await runJevActPipeline(config, harness.value);

    expect(outcome.kind).toBe("done");
    expect(
      harness.takeAction.mock.calls.map(([action]) => [action.method, action.selector]),
    ).toEqual([
      ["fill", "xpath=/html/body/input"],
      ["click", "xpath=/html/body/ul/li[2]"],
    ]);
  });

  it("drags with two independent picks", async () => {
    const tree = [
      "[0-1] div",
      "  [0-2] StaticText: Box A",
      "[0-3] div",
      "  [0-4] StaticText: Box B",
    ].join("\n");
    stubJev({
      family: choice("drag"),
      strict: choice("0-2"),
      best: (question: { instructions?: { question?: string } }) =>
        choice(String(question.instructions?.question).startsWith("Onto") ? "0-4" : "0-2"),
    });
    const { value, takeAction } = deps(
      tree,
      { "0-2": "/html/body/div[1]/text()", "0-4": "/html/body/div[2]/text()" },
      {
        instruction: "drag box A onto box B",
      },
    );

    expect((await runJevActPipeline(config, value)).kind).toBe("done");
    expect(takeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "dragAndDrop",
        selector: "xpath=/html/body/div[1]",
        arguments: ["xpath=/html/body/div[2]"],
      }),
    );
  });

  it("retries the runner-up when an ambiguous click changes nothing", async () => {
    const tree = ["[0-1] button: Save", "[0-2] button: Save draft"].join("\n");
    stubJev({
      family: choice("click"),
      strict: choice("0-1"),
      best: () => ({
        type: "choice",
        choice: "0-1",
        confidence: 0.72,
        probabilities: { "0-1": 0.6, "0-2": 0.4 },
      }),
    });
    const { value, takeAction } = deps(
      tree,
      { "0-1": "/html/body/button[1]", "0-2": "/html/body/button[2]" },
      {
        instruction: "click save",
      },
    );

    // Off by default: a second click is a second side effect.
    await runJevActPipeline(config, value);
    expect(takeAction).toHaveBeenCalledTimes(1);

    takeAction.mockClear();
    const outcome = await runJevActPipeline({ ...config, retryNoEffect: true }, value);

    expect(outcome).toMatchObject({ kind: "done", noCache: true });
    expect(takeAction.mock.calls.map(([action]) => action.selector)).toEqual([
      "xpath=/html/body/button[1]",
      "xpath=/html/body/button[2]",
    ]);
  });

  it("fails fast on a bot wall instead of paying for the LLM, and shortlists otherwise", async () => {
    const wall = [
      "[0-1] RootWebArea: Access Denied",
      "  [0-2] StaticText: You don't have permission to access this server",
    ].join("\n");
    stubJev({
      family: choice("click"),
      strict: choice("none_match", 0.99),
      best: best("0-2", 0.1),
      access_denied: noul(0.97),
    });
    const blocked = deps(
      wall,
      { "0-2": "/html/body/text()" },
      { instruction: "click on the all filters button" },
    );
    expect(await runJevActPipeline(config, blocked.value)).toMatchObject({
      kind: "done",
      result: { success: false, message: expect.stringContaining("access denied") },
    });

    // Vetoed by strict, but Jev's shortlist is credible: it rides along for the LLM.
    stubJev({ family: choice("fill"), strict: choice("none_match", 0.99), best: best("0-5", 0.9) });
    const unsure = deps(
      FORM,
      { "0-5": "/html/body/form/input" },
      { instruction: "type 'x' into the fax field" },
    );
    expect(await runJevActPipeline(config, unsure.value)).toMatchObject({
      kind: "fallback",
      focusIds: expect.arrayContaining(["0-5"]),
    });
  });
});

describe("jev act argument parsing", () => {
  it("collects quoted spans and known variable placeholders", () => {
    expect(fillValueCandidates("type 'nunya' into the 'first name' field")).toEqual([
      "nunya",
      "first name",
    ]);
    expect(fillValueCandidates("type %user% and %missing%", { user: "x" })).toEqual(["%user%"]);
  });

  it("parses scroll positions and keys", () => {
    expect(parsePercent("scroll down 50% inside the iframe")).toBe("50%");
    expect(parsePercent("scroll halfway")).toBe("50%");
    expect(parsePercent("scroll a bit")).toBeUndefined();
    expect(parseKey("press enter")).toBe("Enter");
    expect(parseKey("press the 'a' key")).toBe("a");
  });
});

describe("resolveFamily merges", () => {
  it("lets press win the click/press merge when press leads", () => {
    const merged = resolveFamily(
      {
        type: "choice",
        choice: "press",
        confidence: 0.6,
        probabilities: { press: 0.6, click: 0.3, fill: 0.1 },
      },
      0.7,
    );
    expect(merged.choice).toBe("press");
    expect(merged.confidence).toBeCloseTo(0.9);
  });
});

describe("jev act pipeline and DOM settle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks intent while the DOM settles, and touches the page only afterwards", async () => {
    const order: string[] = [];
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        order.push("intent");
        // The page settles only after Jev has answered.
        setTimeout(() => {
          order.push("settled");
          settle();
        }, 5);
        const answer = (choice: string) => ({
          type: "choice",
          choice,
          confidence: 0.99,
          probabilities: { [choice]: 0.99 },
        });
        return new Response(
          JSON.stringify({
            answers: {
              family: answer("press"),
              key: answer("Enter"),
              mouse_button: answer("left"),
              toggle_state: answer("unspecified"),
              after_typing: answer("nothing"),
              scroll_scope: answer("not_scroll"),
            },
            usage: { input_tokens: 10 },
          }),
          { status: 200 },
        );
      }),
    );
    const outcome = await runJevActPipeline(
      { apiKey: "test" },
      {
        page: { url: () => "https://example.com" } as never,
        logger: new StagehandLogger({ tracer: trace.getTracer("jev-settle-test") }, () => {}),
        instruction: "press Enter",
        snapshotOptions: {},
        ensureTimeRemaining: () => {},
        settled,
        takeAction: async (action) => {
          order.push("act");
          return { success: true, message: "ok", actionDescription: "", actions: [action] };
        },
      },
    );
    expect(outcome.kind).toBe("done");
    expect(order).toEqual(["intent", "settled", "act"]);
  });
});

describe("jev act pipeline target readiness", () => {
  const tree = ["[0-1] RootWebArea: Shop", "  [0-7] button: Checkout"].join("\n");
  const xpaths = { "0-7": "/html/body/button" };
  const never = new Promise<void>(() => {});

  const QUIET = {
    imgs_pending: 0,
    aria_busy: 0,
    progressbars: 0,
    spinner_like: 0,
    interactive: 12,
    text_chars: 4000,
  };
  const BUSY = { ...QUIET, imgs_pending: 3 };

  /** The in-page guard's verdicts, in the order it is called; cues default to quiet. */
  function locator(verdicts: string[], backendNodeId = 7, cues = QUIET, cuesLater = cues) {
    let calls = 0;
    return {
      backendNodeId: async () => backendNodeId,
      resolveNode: async () => ({ objectId: "obj-1" }),
      getFrame: () => ({
        session: {
          send: async (method: string) =>
            method === "Runtime.callFunctionOn"
              ? {
                  result: {
                    value: {
                      verdict: verdicts[Math.min(calls++, verdicts.length - 1)],
                      cues,
                      cuesLater,
                    },
                  },
                }
              : {},
        },
      }),
      inputValue: async () => "",
    } as never;
  }

  it("acts before the DOM-settle wait is over when the target is found and stays put", async () => {
    stubJev({ family: choice("click"), strict: choice("0-7"), best: best("0-7", 0.95) });
    vi.mocked(resolveLocatorWithHops).mockResolvedValueOnce(locator(["ok"]));
    const d = deps(tree, xpaths, { instruction: "click Checkout", settled: never });
    const outcome = await runJevActPipeline({ ...config, targetReadiness: true }, d.value);
    expect(outcome.kind).toBe("done");
    expect(d.takeAction).toHaveBeenCalledTimes(1);
    // The settle promise never resolves: only readiness let this act through.
    expect(d.captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("waits for the settle heuristic while the target is moving or covered", async () => {
    stubJev({ family: choice("click"), strict: choice("0-7"), best: best("0-7", 0.95) });
    vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator(["moving", "covered", "moving"]));
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const d = deps(tree, xpaths, { instruction: "click Checkout", settled });
    const running = runJevActPipeline({ ...config, targetReadiness: true }, d.value);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(d.takeAction).not.toHaveBeenCalled();
    settle();
    expect((await running).kind).toBe("done");
    expect(d.takeAction).toHaveBeenCalledTimes(1);
    vi.mocked(resolveLocatorWithHops).mockReset();
    vi.mocked(resolveLocatorWithHops).mockImplementation(
      async () => ({ inputValue: async () => "business" }) as never,
    );
  });

  it("with pageSettled, waits while loading cues are busy even though the target is stable", async () => {
    stubJev({ family: choice("click"), strict: choice("0-7"), best: best("0-7", 0.95) });
    vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator(["ok"], 7, BUSY));
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const d = deps(tree, xpaths, { instruction: "click Checkout", settled });
    const running = runJevActPipeline(
      { ...config, targetReadiness: true, pageSettled: true },
      d.value,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(d.takeAction).not.toHaveBeenCalled();
    settle();
    expect((await running).kind).toBe("done");
    vi.mocked(resolveLocatorWithHops).mockReset();
    vi.mocked(resolveLocatorWithHops).mockImplementation(
      async () => ({ inputValue: async () => "business" }) as never,
    );
  });

  it("with pageSettled, asks Jev over the cues and goes early only when it calls the page settled", async () => {
    const calls = stubJev({
      family: choice("click"),
      strict: choice("0-7"),
      best: best("0-7", 0.95),
      stage: {
        type: "choice",
        choice: "settled",
        confidence: 0.9,
        probabilities: { settled: 0.9, loading: 0.1 },
      },
    });
    vi.mocked(resolveLocatorWithHops).mockResolvedValueOnce(locator(["ok"]));
    const d = deps(tree, xpaths, {
      instruction: "click Checkout",
      settled: never,
      network: { inflight: 0 },
    });
    const outcome = await runJevActPipeline(
      { ...config, targetReadiness: true, pageSettled: true },
      d.value,
    );
    expect(outcome.kind).toBe("done");
    expect(d.takeAction).toHaveBeenCalledTimes(1);
    const settledCall = calls.find((call) => "stage" in call.questions);
    expect(settledCall).toBeDefined();
    expect(JSON.stringify(settledCall!.state)).toContain("loading_cues");

    stubJev({
      family: choice("click"),
      strict: choice("0-7"),
      best: best("0-7", 0.95),
      stage: {
        type: "choice",
        choice: "loading",
        confidence: 0.8,
        probabilities: { settled: 0.2, loading: 0.8 },
      },
    });
    vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator(["ok"]));
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const held = deps(tree, xpaths, {
      instruction: "click Checkout",
      settled,
      network: { inflight: 0 },
    });
    const running = runJevActPipeline(
      { ...config, targetReadiness: true, pageSettled: true },
      held.value,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(held.takeAction).not.toHaveBeenCalled();
    settle();
    expect((await running).kind).toBe("done");
    vi.mocked(resolveLocatorWithHops).mockReset();
    vi.mocked(resolveLocatorWithHops).mockImplementation(
      async () => ({ inputValue: async () => "business" }) as never,
    );
  });

  it("with pageSettled, in-flight network requests count as busy", async () => {
    stubJev({ family: choice("click"), strict: choice("0-7"), best: best("0-7", 0.95) });
    vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator(["ok"]));
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const d = deps(tree, xpaths, {
      instruction: "click Checkout",
      settled,
      network: { inflight: 2 },
    });
    const running = runJevActPipeline(
      { ...config, targetReadiness: true, pageSettled: true },
      d.value,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(d.takeAction).not.toHaveBeenCalled();
    settle();
    await running;
    vi.mocked(resolveLocatorWithHops).mockReset();
    vi.mocked(resolveLocatorWithHops).mockImplementation(
      async () => ({ inputValue: async () => "business" }) as never,
    );
  });

  it("does not trust a selector that now resolves to a different node", async () => {
    stubJev({ family: choice("click"), strict: choice("0-7"), best: best("0-7", 0.95) });
    vi.mocked(resolveLocatorWithHops).mockResolvedValue(locator(["ok"], 99));
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const d = deps(tree, xpaths, { instruction: "click Checkout", settled });
    const running = runJevActPipeline({ ...config, targetReadiness: true }, d.value);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(d.takeAction).not.toHaveBeenCalled();
    settle();
    await running;
    expect(d.takeAction).toHaveBeenCalledTimes(1);
    vi.mocked(resolveLocatorWithHops).mockReset();
    vi.mocked(resolveLocatorWithHops).mockImplementation(
      async () => ({ inputValue: async () => "business" }) as never,
    );
  });
});
