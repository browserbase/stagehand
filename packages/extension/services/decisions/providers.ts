/**
 * Decision-model providers. A decision model answers typed questions about a
 * state (pick one option, yes/no) with probabilities instead of text. Three of
 * the four providers here speak the same "System One" request shape; OpenAI's
 * Decisions API carries the same information in a different one. Each provider
 * is a codec: how to address it, how to encode a request, how to read answers.
 * Everything else (timeouts, retries, circuit breaking, validation, splitting
 * oversized requests) is shared in client.ts.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DecisionQuestion =
  | { type: "choice"; instructions: JsonValue; criteria: Record<string, JsonValue> }
  | { type: "noul"; instructions: JsonValue; criteria?: { true: JsonValue; false: JsonValue } };

export type DecisionChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type DecisionNoulAnswer = { type: "noul"; noul: number };

export type DecisionAnswer = DecisionChoiceAnswer | DecisionNoulAnswer;

export const DECISION_PROVIDERS = ["typesafe", "cloudflare", "perplexity", "openai"] as const;
export type DecisionProviderName = (typeof DECISION_PROVIDERS)[number];

export type DecisionModelConfig = {
  /** Which decision model service to call. Default `"typesafe"`. */
  provider?: DecisionProviderName;
  apiKey: string;
  model?: string;
  /** Overrides the provider's base URL (https only). */
  apiUrl?: string;
  /** Cloudflare account id; required for `provider: "cloudflare"` unless `apiUrl` names the account. */
  accountId?: string;
};

export type EncodedRequest = { url: string; headers: Record<string, string>; body: JsonValue };

/** Answers as the provider returned them, keyed by the question keys that were sent. */
export type DecodedResponse = {
  model: string;
  answers: Record<string, unknown>;
  usage: { inputTokens: number; outputTokens: number };
};

export type DecisionProvider = {
  name: DecisionProviderName;
  /** Used in error messages and logs. */
  label: string;
  defaultModel: string;
  defaultTimeoutMs: number;
  /** A request with more questions is split into several (same state) and the answers merged. */
  maxQuestions: number;
  /**
   * Question keys and option ids the provider accepts as they are. Others are
   * sent under a generated alias and mapped back, so callers never care.
   */
  safeId: RegExp;
  /** Whether instructions and option descriptions may be JSON values, or must be text. */
  structuredText: boolean;
  encode(
    config: DecisionModelConfig,
    state: JsonValue,
    questions: Record<string, DecisionQuestion>,
  ): EncodedRequest;
  /** Undefined when the payload is not this provider's success shape. */
  decode(payload: unknown): DecodedResponse | undefined;
  /** A short machine-readable reason from an error body; never the raw body. */
  errorCode(body: string): string | undefined;
};

const ANY_ID = /^[\s\S]+$/;
/** Cloudflare documents this alphabet for question ids; it is also a safe floor for the others. */
const PLAIN_ID = /^[A-Za-z0-9_.-]{1,100}$/;

function base(config: DecisionModelConfig, fallback: string): string {
  return (config.apiUrl ?? fallback).replace(/\/+$/, "");
}

function bearer(config: DecisionModelConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function usageOf(payload: Record<string, unknown>): DecodedResponse["usage"] {
  const usage = record(payload.usage) ?? {};
  const number = (value: unknown): number => (typeof value === "number" ? value : 0);
  return {
    inputTokens: number(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: number(usage.output_tokens ?? usage.completion_tokens),
  };
}

/** `{ model, answers: { key: answer }, usage }`, optionally inside Workers AI's `{ result }` envelope. */
function decodeSystemOne(payload: unknown): DecodedResponse | undefined {
  const outer = record(payload);
  const body = outer && record(outer.result) ? record(outer.result)! : outer;
  const answers = body && record(body.answers);
  if (!body || !answers) return undefined;
  return {
    model: typeof body.model === "string" ? body.model : "",
    answers,
    usage: usageOf(body),
  };
}

function errorType(body: string): string | undefined {
  return /"(?:error_type|type|code)"\s*:\s*"([\w.-]{1,64})"/.exec(body)?.[1];
}

export const TYPESAFE_DEFAULT_API_URL = "https://api.typesafe.ai";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";

const typesafe: DecisionProvider = {
  name: "typesafe",
  label: "TypeSafe",
  defaultModel: TYPESAFE_DEFAULT_MODEL,
  defaultTimeoutMs: 8_000,
  // No documented limit; requests are sent whole, as they always were.
  maxQuestions: 1_000,
  safeId: ANY_ID,
  structuredText: true,
  encode: (config, state, questions) => ({
    url: `${base(config, TYPESAFE_DEFAULT_API_URL)}/v1/systemone`,
    headers: bearer(config),
    body: { state, model: config.model ?? TYPESAFE_DEFAULT_MODEL, questions },
  }),
  decode: decodeSystemOne,
  errorCode: (body) => /"error_type"\s*:\s*"([\w-]{1,64})"/.exec(body)?.[1],
};

/** Clef on Workers AI: System One body, account-scoped URL, answers inside `{ result }`. */
const cloudflare: DecisionProvider = {
  name: "cloudflare",
  label: "Cloudflare",
  defaultModel: "clef",
  defaultTimeoutMs: 15_000,
  maxQuestions: 64,
  safeId: PLAIN_ID,
  structuredText: false,
  encode: (config, state, questions) => {
    const model = config.model ?? "clef";
    const slug = model.startsWith("@") ? model : `@cf/cloudflare/${model}`;
    let root: string;
    if (config.apiUrl) root = base(config, "");
    else if (config.accountId) {
      root = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run`;
    } else {
      throw new Error('experimentalDecisions: provider "cloudflare" needs accountId (or apiUrl)');
    }
    return {
      url: `${root}/${slug}`,
      headers: bearer(config),
      body: { model: slug.slice(slug.lastIndexOf("/") + 1), state, questions },
    };
  },
  decode: decodeSystemOne,
  errorCode: (body) => /"code"\s*:\s*(\d{3,6})/.exec(body)?.[1] ?? errorType(body),
};

const perplexity: DecisionProvider = {
  name: "perplexity",
  label: "Perplexity",
  defaultModel: "pplx-decider-v1-27b",
  defaultTimeoutMs: 15_000,
  maxQuestions: 128,
  safeId: PLAIN_ID,
  structuredText: false,
  encode: (config, state, questions) => ({
    url: `${base(config, "https://api.perplexity.ai")}/v1/decisions`,
    headers: bearer(config),
    body: { model: config.model ?? "pplx-decider-v1-27b", state, questions },
  }),
  decode: decodeSystemOne,
  errorCode: errorType,
};

/**
 * OpenAI's Decisions API (limited preview). No schema is published; this
 * follows the request and response recorded by preview users and OpenAI's own
 * client: one `input` string, a list of named questions (`predicate`,
 * `choice`), and probabilities as lists. Yes/no criteria have no field of
 * their own and are folded into the instructions.
 */
const openai: DecisionProvider = {
  name: "openai",
  label: "OpenAI",
  defaultModel: "gpt-6-luna",
  defaultTimeoutMs: 15_000,
  maxQuestions: 64,
  safeId: PLAIN_ID,
  structuredText: false,
  encode: (config, state, questions) => ({
    url: `${base(config, "https://api.openai.com")}/v1/decisions`,
    headers: bearer(config),
    body: {
      model: config.model ?? "gpt-6-luna",
      input: typeof state === "string" ? state : JSON.stringify(state),
      questions: Object.entries(questions).map(
        ([name, question]): JsonValue =>
          question.type === "noul"
            ? {
                type: "predicate",
                name,
                instructions: question.criteria
                  ? `${String(question.instructions)}\nYes: ${String(question.criteria.true)}\nNo: ${String(question.criteria.false)}`
                  : question.instructions,
              }
            : {
                type: "choice",
                name,
                instructions: question.instructions,
                choices: Object.entries(question.criteria).map(
                  ([value, description]): JsonValue =>
                    description === null || description === "" ? { value } : { value, description },
                ),
              },
      ),
    },
  }),
  decode: (payload) => {
    const body = record(payload);
    if (!body || !Array.isArray(body.answers)) return undefined;
    const answers: Record<string, unknown> = {};
    for (const entry of body.answers) {
      const answer = record(entry);
      if (!answer || typeof answer.name !== "string") return undefined;
      if (answer.type === "predicate") {
        answers[answer.name] = { type: "noul", noul: answer.probability };
      } else if (answer.type === "choice" && Array.isArray(answer.probabilities)) {
        const probabilities: Record<string, unknown> = {};
        for (const item of answer.probabilities) {
          const option = record(item);
          if (!option || typeof option.value !== "string") return undefined;
          probabilities[option.value] = option.probability;
        }
        answers[answer.name] = {
          type: "choice",
          choice: answer.choice,
          probabilities,
          confidence: answer.confidence,
        };
      } else {
        answers[answer.name] = answer;
      }
    }
    return {
      model: typeof body.model === "string" ? body.model : "",
      answers,
      usage: usageOf(body),
    };
  },
  errorCode: (body) =>
    /Decision API is not enabled/i.test(body) ? "decisions_not_enabled" : errorType(body),
};

const PROVIDERS: Record<DecisionProviderName, DecisionProvider> = {
  typesafe,
  cloudflare,
  perplexity,
  openai,
};

export function providerFor(config: DecisionModelConfig): DecisionProvider {
  const provider = PROVIDERS[config.provider ?? "typesafe"];
  if (!provider) {
    throw new Error(`experimentalDecisions: unknown provider "${String(config.provider)}"`);
  }
  return provider;
}
