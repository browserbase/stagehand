import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decide,
  DECISION_PROVIDERS,
  DecisionRequestError,
  type DecisionModelConfig,
  type DecisionProviderName,
  type DecisionQuestion,
} from "../services/decisions/client.js";
import { fakeDecisionProvider } from "./decisionsTestUtils.js";

/**
 * Every provider must give the pipeline the same thing for the same question.
 * `fakeProvider` is a server for each wire format: it reads the request the
 * way that provider documents it and answers in that provider's own shape.
 */
type WireQuestion = { type: string; options: string[] };
type Scripted = (key: string, question: WireQuestion) => { choice?: string; p?: number };

const CONFIGS: Record<DecisionProviderName, DecisionModelConfig> = {
  typesafe: { provider: "typesafe", apiKey: "ts-key" },
  cloudflare: { provider: "cloudflare", apiKey: "cf-token", accountId: "acct123" },
  perplexity: { provider: "perplexity", apiKey: "pplx-key" },
};

const EXPECTED_URL: Record<DecisionProviderName, string> = {
  typesafe: "https://api.typesafe.ai/v1/systemone",
  cloudflare: "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/cloudflare/clef",
  perplexity: "https://api.perplexity.ai/v1/decisions",
};

function fakeProvider(name: DecisionProviderName, script: Scripted) {
  return fakeDecisionProvider(
    name,
    (key, question) => script(key, { type: question.type, options: question.options }),
    (fetchMock) => vi.stubGlobal("fetch", vi.fn(fetchMock)),
  );
}

const QUESTIONS: Record<string, DecisionQuestion> = {
  family: {
    type: "choice",
    instructions: "Which kind of browser action does the instruction ask for?",
    criteria: { click: "A click", fill: "Typing text into a field", scroll: "Scrolling" },
  },
  // Ids a strict provider would reject: a colon in the key, spaces and slashes in the options.
  "tool_arg:add_to_cart:size": {
    type: "choice",
    instructions: { task: "Which size?", request: "add the large one" },
    criteria: { "size / L": { label: "Large" }, "size / M": { label: "Medium" }, unset: null },
  },
  names_control: {
    type: "noul",
    instructions: { question: "Does the request name a control?", request: "add the large one" },
    criteria: { true: "It names a button or link", false: "It states a goal" },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe.each(DECISION_PROVIDERS)("decision provider %s", (name) => {
  const config = () => ({ ...CONFIGS[name], apiKey: `${CONFIGS[name].apiKey}-${Math.random()}` });

  it("answers the same questions with the same normalised result", async () => {
    const seen = fakeProvider(name, (key, question) => {
      if (key === "family") return { choice: "fill", p: 0.92 };
      if (question.type === "noul") return { p: 0.11 };
      // The second option, whatever it is called on the wire.
      return { choice: question.options[1]!, p: 0.8 };
    });
    const response = await decide(config(), { instruction: "add the large one" }, QUESTIONS);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(EXPECTED_URL[name]);
    expect(seen[0]!.headers.Authorization).toMatch(/^Bearer /);
    expect(response.answers.family).toMatchObject({
      type: "choice",
      choice: "fill",
      confidence: 0.92,
    });
    expect(
      Object.keys((response.answers.family as { probabilities: object }).probabilities).sort(),
    ).toEqual(["click", "fill", "scroll"]);
    // Aliased on the wire where needed, but always the caller's own ids coming back.
    expect(response.answers["tool_arg:add_to_cart:size"]).toMatchObject({
      type: "choice",
      choice: "size / M",
      confidence: 0.8,
    });
    expect(
      Object.keys(
        (response.answers["tool_arg:add_to_cart:size"] as { probabilities: object }).probabilities,
      ).sort(),
    ).toEqual(["size / L", "size / M", "unset"]);
    expect(response.answers.names_control).toEqual({ type: "noul", noul: 0.11 });
    expect(response.usage).toEqual({ inputTokens: 40, outputTokens: 3 });
  });

  it("never sends a one-option choice and answers it as certain", async () => {
    const seen = fakeProvider(name, () => ({ p: 0.3 }));
    const response = await decide(
      config(),
      {},
      {
        only: { type: "choice", instructions: "Which?", criteria: { "0-7": "the one candidate" } },
        also: { type: "noul", instructions: "Is it?" },
      },
    );
    expect(response.answers.only).toEqual({
      type: "choice",
      choice: "0-7",
      probabilities: { "0-7": 1 },
      confidence: 1,
    });
    const sent = JSON.stringify(seen[0]!.body);
    expect(sent).not.toContain("the one candidate");
    expect(response.answers.also).toEqual({ type: "noul", noul: 0.3 });
  });

  it("splits a request past the provider's question limit and merges the answers", async () => {
    const seen = fakeProvider(name, (key) => ({ p: key === "q149" ? 0.99 : 0.01 }));
    const many = Object.fromEntries(
      Array.from({ length: 150 }, (_, index) => [
        `q${index}`,
        { type: "noul" as const, instructions: `Is candidate ${index} relevant?` },
      ]),
    );
    const response = await decide(config(), { page: "x" }, many);
    expect(Object.keys(response.answers)).toHaveLength(150);
    expect(response.answers.q149).toEqual({ type: "noul", noul: 0.99 });
    const expectedRequests = { typesafe: 1, cloudflare: 3, perplexity: 2 }[name];
    expect(seen).toHaveLength(expectedRequests);
    expect(response.usage.inputTokens).toBe(40 * expectedRequests);
  });

  it("rejects answers that do not fit the question instead of acting on them", async () => {
    const question = {
      pick: { type: "choice" as const, instructions: "Which?", criteria: { a: "A", b: "B" } },
    };
    const reply = (answer: Record<string, unknown>) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          const payload = { answers: { pick: { type: "choice", ...answer } } };
          return Response.json(
            name === "cloudflare" ? { result: payload, success: true } : payload,
          );
        }),
      );
    };
    reply({ choice: "c", confidence: 0.9, probabilities: { c: 0.9 } });
    await expect(decide(config(), {}, question)).rejects.toThrow(/not one of the options/);
    reply({ choice: "a", confidence: 0.9, probabilities: { a: 1.4, b: 0.1 } });
    await expect(decide(config(), {}, question)).rejects.toThrow(/out of range/);
    reply({ choice: "a", confidence: 0.2, probabilities: { a: 0.2, b: 0.8 } });
    await expect(decide(config(), {}, question)).rejects.toThrow(/not the most likely/);
    reply({ choice: "a", confidence: 0.3, probabilities: { a: 0.3, b: 0.3 } });
    await expect(decide(config(), {}, question)).rejects.toThrow(/do not sum to 1/);
  });

  it("surfaces auth, overload and garbage as typed errors and pauses after a bad key", async () => {
    const one = { q: { type: "noul" as const, instructions: "Is it?" } };
    const shared = config();
    const unauthorised = vi.fn(
      async () => new Response('{"error":{"type":"auth"}}', { status: 401 }),
    );
    vi.stubGlobal("fetch", unauthorised);
    await expect(decide(shared, {}, one)).rejects.toBeInstanceOf(DecisionRequestError);
    await expect(decide(shared, {}, one)).rejects.toThrow(/paused/);
    expect(unauthorised).toHaveBeenCalledTimes(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })),
    );
    await expect(decide(config(), {}, one)).rejects.toThrow(/not a decision payload/);

    // 429 with Retry-After is retried, then succeeds.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (++calls === 1)
          return new Response("{}", { status: 429, headers: { "retry-after": "0.01" } });
        const noul = { answers: { q: { type: "noul", noul: 0.7 } } };
        return Response.json(name === "cloudflare" ? { result: noul, success: true } : noul);
      }),
    );
    await expect(decide(config(), {}, one)).resolves.toMatchObject({
      answers: { q: { type: "noul", noul: 0.7 } },
    });
    expect(calls).toBe(2);
  });
});

describe("provider wire formats", () => {
  it("keeps TypeSafe's request exactly as the pipeline wrote it", async () => {
    const seen = fakeProvider("typesafe", () => ({ p: 0.5 }));
    await decide(
      { provider: "typesafe", apiKey: `k-${Math.random()}` },
      { url: "https://e.com" },
      QUESTIONS,
    );
    expect(seen[0]!.body).toEqual({
      state: { url: "https://e.com" },
      model: "jev-1.14.0",
      questions: QUESTIONS,
    });
  });

  it("sends Cloudflare and Perplexity text-only instructions and wire-safe ids", async () => {
    for (const name of ["cloudflare", "perplexity"] as const) {
      const seen = fakeProvider(name, () => ({ p: 0.5 }));
      await decide(
        { ...CONFIGS[name], apiKey: `k-${Math.random()}` },
        { url: "https://e.com" },
        QUESTIONS,
      );
      const body = seen[0]!.body as {
        model: string;
        state: unknown;
        questions: Record<string, { instructions: unknown; criteria?: Record<string, unknown> }>;
      };
      expect(body.model).toBe(name === "cloudflare" ? "clef" : "pplx-decider-v1.3");
      expect(body.state).toEqual({ url: "https://e.com" });
      const keys = Object.keys(body.questions);
      expect(keys.every((key) => /^[A-Za-z0-9_.-]{1,100}$/.test(key))).toBe(true);
      expect(keys).toContain("family");
      expect(keys).not.toContain("tool_arg:add_to_cart:size");
      for (const question of Object.values(body.questions)) {
        expect(typeof question.instructions).toBe("string");
        for (const [id, description] of Object.entries(question.criteria ?? {})) {
          expect(id).toMatch(/^[A-Za-z0-9_.-]{1,100}$/);
          expect(description === null || typeof description === "string").toBe(true);
        }
      }
      // The aliased option still tells the model what it is.
      const aliased =
        body.questions[keys.find((key) => key !== "family" && key !== "names_control")!]!;
      expect(JSON.stringify(aliased.criteria)).toContain("size / L");
    }
  });

  it("uses clef-flash and a custom gateway URL when asked", async () => {
    const seen = fakeProvider("cloudflare", () => ({ p: 0.5 }));
    await decide(
      {
        provider: "cloudflare",
        apiKey: `k-${Math.random()}`,
        accountId: "a1",
        model: "clef-flash",
      },
      {},
      { q: { type: "noul", instructions: "Is it?" } },
    );
    expect(seen[0]!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/a1/ai/run/@cf/cloudflare/clef-flash",
    );
    await expect(
      decide(
        { provider: "cloudflare", apiKey: "k" },
        {},
        { q: { type: "noul", instructions: "?" } },
      ),
    ).rejects.toThrow(/accountId/);
  });

  it("refuses a non-https endpoint and an unknown provider", async () => {
    await expect(
      decide(
        { apiKey: "k", apiUrl: "http://localhost:1" },
        {},
        { q: { type: "noul", instructions: "?" } },
      ),
    ).rejects.toThrow(/https/);
    await expect(
      decide(
        { apiKey: "k", provider: "nope" as never },
        {},
        { q: { type: "noul", instructions: "?" } },
      ),
    ).rejects.toThrow(/unknown provider/);
  });
});
