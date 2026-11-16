/** Wire adapters for the providers used by the decision pipeline. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type DecisionQuestion =
  | { type: "choice"; instructions: JsonValue; criteria: Record<string, JsonValue> }
  | { type: "locate"; instructions: JsonValue }
  | { type: "noul"; instructions: JsonValue; criteria?: { true: JsonValue; false: JsonValue } };

export type DecisionChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type DecisionNoulAnswer = { type: "noul"; noul: number };

export type DecisionLocateAnswer = {
  type: "locate";
  spans: { start: number; end: number; text: string; score: number }[];
};
export type DecisionAnswer = DecisionChoiceAnswer | DecisionNoulAnswer | DecisionLocateAnswer;

export const DECISION_PROVIDERS = ["typesafe", "cloudflare", "perplexity"] as const;
export type DecisionProviderName = (typeof DECISION_PROVIDERS)[number];

export type DecisionModelConfig = {
  /** Which decision model service to call. Default `"perplexity"`. */
  provider?: DecisionProviderName;
  apiKey: string;
  signal?: AbortSignal;
  recordDecisionUsage?: (
    usage: DecodedResponse["usage"] & { provider?: DecisionProviderName; model?: string },
  ) => void;
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
  supportsLocate: boolean;
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
  const tokenCount = (value: unknown): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return {
    inputTokens: tokenCount(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: tokenCount(usage.output_tokens ?? usage.completion_tokens),
  };
}

/** `{ model, answers: { key: answer }, usage }`, optionally inside Workers AI's `{ result }` envelope. */
function decodeSystemOne(payload: unknown): DecodedResponse | undefined {
  const outer = record(payload);
  const body = record(outer?.result) ?? outer;
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
export const TYPESAFE_DEFAULT_MODEL = "jev-1.14.0";
export const PERPLEXITY_DEFAULT_MODEL = "pplx-decider-v1.3";

const typesafe: DecisionProvider = {
  name: "typesafe",
  label: "TypeSafe",
  defaultModel: TYPESAFE_DEFAULT_MODEL,
  defaultTimeoutMs: 8_000,
  // No documented limit; requests are sent whole, as they always were.
  maxQuestions: 1_000,
  supportsLocate: false,
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
  supportsLocate: false,
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
  defaultModel: PERPLEXITY_DEFAULT_MODEL,
  defaultTimeoutMs: 15_000,
  maxQuestions: 128,
  supportsLocate: true,
  safeId: PLAIN_ID,
  structuredText: false,
  encode: (config, state, questions) => ({
    url: `${base(config, "https://api.perplexity.ai")}/v1/decisions`,
    headers: bearer(config),
    body: { model: config.model ?? PERPLEXITY_DEFAULT_MODEL, state, questions },
  }),
  decode: decodeSystemOne,
  errorCode: errorType,
};

const PROVIDERS: Record<DecisionProviderName, DecisionProvider> = {
  typesafe,
  cloudflare,
  perplexity,
};

export function providerFor(config: DecisionModelConfig): DecisionProvider {
  const name = config.provider ?? "perplexity";
  if (!Object.hasOwn(PROVIDERS, name)) {
    throw new Error(`experimentalDecisions: unknown provider "${String(config.provider)}"`);
  }
  return PROVIDERS[name];
}
