/**
 * Shared by the decisions test stubs. A real decision model can only ever
 * answer with one of the options it was offered; the client now rejects
 * anything else. Stubs that script "whatever, nothing matches" answers go
 * through this so they stay short and still look like a provider's reply.
 */
type Question = { type?: string; criteria?: object | null };
type Choice = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

/** Options that mean "none of the above" in the pipeline's questions, in order of preference. */
const NEUTRAL = [
  "none_match",
  "none_of_these",
  "unset",
  "other",
  "unspecified",
  "nothing",
  "not_scroll",
  "left",
];

export function realisticAnswer<T>(question: Question, answer: T): T | Choice {
  const scripted = answer as Partial<Choice> | null;
  if (!scripted || typeof scripted !== "object" || typeof scripted.choice !== "string") {
    return answer;
  }
  const options = Object.keys(question.criteria ?? {});
  if (options.length === 0 || options.includes(scripted.choice)) return answer;
  const neutral = NEUTRAL.find((id) => options.includes(id));
  // No way to say "none": a real model still names an option, just without conviction.
  const choice = neutral ?? options[0]!;
  const confidence = neutral ? (scripted.confidence ?? 0.95) : 0.2;
  return { type: "choice", choice, confidence, probabilities: { [choice]: confidence } };
}

export type FakeProviderName = "typesafe" | "cloudflare" | "perplexity" | "openai";
export type WireQuestion = {
  type: "choice" | "noul";
  /** Option ids exactly as they arrived on the wire (possibly aliased). */
  options: string[];
  /** Instructions plus option descriptions, as text, to script answers by content. */
  text: string;
  descriptions: Record<string, string>;
};
export type ScriptedAnswer = { choice?: string; p?: number };
export type SeenRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

/**
 * A stand-in server for each provider's wire format: it reads the request the
 * way that provider documents it and replies in that provider's own shape.
 * Unscripted choices fall on a "none of the above" option when there is one.
 */
export function fakeDecisionProvider(
  name: FakeProviderName,
  script: (key: string, question: WireQuestion) => ScriptedAnswer | undefined,
  stub: (fetchMock: (url: string, init: RequestInit) => Promise<Response>) => void,
): SeenRequest[] {
  const seen: SeenRequest[] = [];
  const asText = (value: unknown): string =>
    typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const distribution = (options: string[], choice: string, p: number) =>
    Object.fromEntries(
      options.map((id) => [id, id === choice ? p : (1 - p) / Math.max(1, options.length - 1)]),
    );
  const answerChoice = (key: string, question: WireQuestion) => {
    const scripted = script(key, question) ?? {};
    const fallback = NEUTRAL.find((id) => question.options.includes(id)) ?? question.options[0]!;
    const choice =
      scripted.choice && question.options.includes(scripted.choice) ? scripted.choice : fallback;
    return { choice, p: scripted.p ?? 0.95 };
  };

  stub(async (url, init) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    seen.push({ url, headers: init.headers as Record<string, string>, body });

    if (name === "openai") {
      const answers = (body.questions as Array<Record<string, unknown>>).map((question) => {
        const key = question.name as string;
        if (question.type === "predicate") {
          const wire: WireQuestion = {
            type: "noul",
            options: [],
            text: asText(question.instructions),
            descriptions: {},
          };
          return { type: "predicate", name: key, probability: script(key, wire)?.p ?? 0.5 };
        }
        const choices = question.choices as Array<{ value: string; description?: unknown }>;
        const descriptions = Object.fromEntries(
          choices.map((entry) => [entry.value, asText(entry.description)]),
        );
        const wire: WireQuestion = {
          type: "choice",
          options: choices.map((entry) => entry.value),
          text: `${asText(question.instructions)} ${Object.values(descriptions).join(" ")}`,
          descriptions,
        };
        const { choice, p } = answerChoice(key, wire);
        return {
          type: "choice",
          name: key,
          choice,
          confidence: p,
          probabilities: Object.entries(distribution(wire.options, choice, p)).map(
            ([value, probability]) => ({ value, probability }),
          ),
        };
      });
      return Response.json({
        model: "gpt-6-luna",
        answers,
        usage: { input_tokens: 40, output_tokens: 3, total_tokens: 43 },
      });
    }

    const questions = body.questions as Record<
      string,
      { type: string; instructions?: unknown; criteria?: Record<string, unknown> | null }
    >;
    const answers = Object.fromEntries(
      Object.entries(questions).map(([key, question]) => {
        const descriptions = Object.fromEntries(
          Object.entries(question.criteria ?? {}).map(([id, value]) => [id, asText(value)]),
        );
        const text = `${asText(question.instructions)} ${Object.values(descriptions).join(" ")}`;
        if (question.type === "noul") {
          const wire: WireQuestion = { type: "noul", options: [], text, descriptions };
          return [key, { type: "noul", noul: script(key, wire)?.p ?? 0.5 }];
        }
        const wire: WireQuestion = {
          type: "choice",
          options: Object.keys(descriptions),
          text,
          descriptions,
        };
        const { choice, p } = answerChoice(key, wire);
        return [
          key,
          {
            type: "choice",
            choice,
            confidence: p,
            probabilities: distribution(wire.options, choice, p),
          },
        ];
      }),
    );
    const payload = {
      model: String(body.model),
      answers,
      usage: { input_tokens: 40, output_tokens: 3 },
    };
    // Workers AI wraps every model's output.
    return Response.json(
      name === "cloudflare"
        ? { result: payload, success: true, errors: [], messages: [] }
        : payload,
    );
  });
  return seen;
}
