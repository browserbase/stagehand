// Uses fetch because provider SDKs cannot run in the extension service worker.
import {
  providerFor,
  type DecisionAnswer,
  type DecisionChoiceAnswer,
  type DecisionModelConfig,
  type DecisionNoulAnswer,
  type DecisionLocateAnswer,
  type DecisionProvider,
  type DecisionQuestion,
  type JsonValue,
} from "./providers.js";
import { settleAll } from "./concurrency.js";

export type { DecisionModelConfig } from "./providers.js";

export {
  DECISION_PROVIDERS,
  TYPESAFE_DEFAULT_API_URL,
  TYPESAFE_DEFAULT_MODEL,
  PERPLEXITY_DEFAULT_MODEL,
  type DecisionAnswer,
  type DecisionChoiceAnswer,
  type DecisionNoulAnswer,
  type DecisionLocateAnswer,
  type DecisionProviderName,
  type DecisionQuestion,
  type JsonValue,
} from "./providers.js";

export type DecisionResponse = {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
};

const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 2_000;
const AUTH_STATUSES = new Set([401, 403]);
const BREAKER_MS = 60_000;

const FAILURES_TO_OPEN = 3;
const OUTAGE_BREAKER_MS = 30_000;
/** Probabilities are rounded by providers; allow each option half a unit of two-decimal rounding. */
const SUM_SLACK_PER_OPTION = 0.005;

// A bad key, exhausted quota, or a provider outage fails every act the same
// way; skip the decision model for a while instead of paying a doomed round
// trip before each LLM fallback. Keyed by provider + endpoint + key so one
// tenant's bad key does not pause another's in a shared worker.
const breakers = new Map<string, { openUntil: number; failures: number }>();

function breakerFor(config: DecisionModelConfig, provider: DecisionProvider) {
  const key = [provider.name, config.apiUrl ?? "", config.accountId ?? "", config.apiKey].join(
    "\u0000",
  );
  let breaker = breakers.get(key);
  if (!breaker) breakers.set(key, (breaker = { openUntil: 0, failures: 0 }));
  return breaker;
}

export class DecisionRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DecisionRequestError";
  }
}

/** Asks one decision model a set of typed questions about one state. */
export async function decide(
  config: DecisionModelConfig,
  state: JsonValue,
  questions: Record<string, DecisionQuestion>,
): Promise<DecisionResponse> {
  const provider = providerFor(config);
  config.signal?.throwIfAborted();
  if (
    Object.values(questions).some((question) => question.type === "locate") &&
    !provider.supportsLocate
  )
    throw new DecisionRequestError(`${provider.label} does not support exact-span reading`);
  const startedAt = Date.now();
  // A choice among one option has one possible answer (a softmax over one
  // option is 1). Providers reject or waste tokens on it, so it never leaves.
  const settled: Record<string, DecisionAnswer> = Object.create(null);
  for (const [key, question] of Object.entries(questions)) {
    if (question.type !== "choice") continue;
    const options = Object.keys(question.criteria);
    if (options.length === 0) throw new DecisionRequestError(`Question "${key}" has no options`);
    if (options.length === 1) {
      settled[key] = {
        type: "choice",
        choice: options[0]!,
        probabilities: { [options[0]!]: 1 },
        confidence: 1,
      };
    }
  }
  const keys = Object.keys(questions).filter((key) => !Object.hasOwn(settled, key));
  const chunks: string[][] = [];
  for (let start = 0; start < keys.length; start += provider.maxQuestions) {
    chunks.push(keys.slice(start, start + provider.maxQuestions));
  }
  if (chunks.length === 0) {
    return {
      model: config.model ?? provider.defaultModel,
      answers: settled,
      usage: { inputTokens: 0, outputTokens: 0 },
      durationMs: 0,
    };
  }

  // Keep each chunk on the same evidence. Packing can affect providers with cross-field attention.
  const parts = await settleAll(
    chunks.map((chunk) =>
      requestOnce(
        config,
        provider,
        state,
        Object.fromEntries(chunk.map((key) => [key, questions[key]!])),
      ),
    ),
  );
  return {
    model: parts[0]!.model,
    answers: Object.fromEntries([
      ...Object.entries(settled),
      ...parts.flatMap((part) => Object.entries(part.answers)),
    ]),
    usage: {
      inputTokens: parts.reduce((sum, part) => sum + part.usage.inputTokens, 0),
      outputTokens: parts.reduce((sum, part) => sum + part.usage.outputTokens, 0),
    },
    durationMs: Date.now() - startedAt,
  };
}

type Aliases = {
  questions: Record<string, DecisionQuestion>;
  /** wire question key → caller's key */
  keyOf: Map<string, string>;
  /** caller's key → (wire option id → caller's option id) */
  optionOf: Map<string, Map<string, string>>;
};

function text(value: JsonValue): JsonValue {
  return typeof value === "string" || value === null ? value : JSON.stringify(value);
}

/**
 * Rewrites questions into what the provider accepts: ids outside its alphabet
 * get an alias (the description still says what the option is), and JSON
 * instructions or descriptions become text where only text is taken.
 */
function prepare(provider: DecisionProvider, questions: Record<string, DecisionQuestion>): Aliases {
  const keyOf = new Map<string, string>();
  const optionOf = new Map<string, Map<string, string>>();
  const prepared: Record<string, DecisionQuestion> = Object.create(null);
  const reservedKeys = new Set(Object.keys(questions));
  const flatten = (value: JsonValue): JsonValue => (provider.structuredText ? value : text(value));
  let index = 0;
  for (const [key, question] of Object.entries(questions)) {
    let wireKey = key;
    if (!provider.safeId.test(key)) {
      do wireKey = `q${index++}`;
      while (reservedKeys.has(wireKey));
      reservedKeys.add(wireKey);
    }
    keyOf.set(wireKey, key);
    if (question.type === "locate") {
      prepared[wireKey] = { type: "locate", instructions: flatten(question.instructions) };
      continue;
    }
    if (question.type === "noul") {
      prepared[wireKey] = {
        type: "noul",
        instructions: flatten(question.instructions),
        ...(question.criteria
          ? {
              criteria: {
                true: flatten(question.criteria.true),
                false: flatten(question.criteria.false),
              },
            }
          : {}),
      };
      continue;
    }
    const options = new Map<string, string>();
    const ids = Object.keys(question.criteria);
    const aliasAll = ids.some((id) => !provider.safeId.test(id));
    const criteria: Record<string, JsonValue> = Object.create(null);
    ids.forEach((id, position) => {
      const wireId = aliasAll ? `o${position}` : id;
      options.set(wireId, id);
      const description = question.criteria[id]!;
      // An aliased id no longer says anything: keep the original in the description.
      criteria[wireId] = aliasAll
        ? flatten(
            description === null || description === ""
              ? id
              : typeof description === "string"
                ? `${id}: ${description}`
                : {
                    id,
                    ...(typeof description === "object" && !Array.isArray(description)
                      ? description
                      : { is: description }),
                  },
          )
        : flatten(description);
    });
    optionOf.set(key, options);
    prepared[wireKey] = { type: "choice", instructions: flatten(question.instructions), criteria };
  }
  return { questions: prepared, keyOf, optionOf };
}

function probability(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/** A provider's answer, checked against the question that was asked. Throws on anything unusable. */
function validate(
  provider: DecisionProvider,
  key: string,
  question: DecisionQuestion,
  raw: unknown,
  options: Map<string, string> | undefined,
  state: JsonValue,
): DecisionAnswer {
  const bad = (why: string): never => {
    throw new DecisionRequestError(
      `${provider.label} returned an invalid answer for "${key}" (${why})`,
    );
  };
  const answer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : bad("missing");
  if (question.type === "locate") {
    if (typeof state !== "string" || !Array.isArray(answer.spans))
      return bad("invalid span payload");
    const points = Array.from(state);
    const spans = answer.spans.map((rawSpan) => {
      if (!rawSpan || typeof rawSpan !== "object") return bad("invalid span");
      const span = rawSpan as Record<string, unknown>;
      const { start, end, text } = span;
      const score = probability(span.score);
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end <= start ||
        end > points.length ||
        typeof text !== "string" ||
        points.slice(start, end).join("") !== text ||
        score === undefined
      )
        return bad("span does not match evidence");
      return { start, end, text, score };
    });
    return { type: "locate", spans };
  }
  if (question.type === "noul") {
    const noul = probability(answer.noul ?? answer.probability);
    return { type: "noul", noul: noul ?? bad("noul out of range") };
  }
  const original = (wireId: unknown): string | undefined =>
    typeof wireId === "string" ? options?.get(wireId) : undefined;
  const choice = original(answer.choice) ?? bad("choice is not one of the options");
  const probabilities: Record<string, number> = Object.create(null);
  const listed =
    answer.probabilities && typeof answer.probabilities === "object"
      ? Object.entries(answer.probabilities as Record<string, unknown>)
      : [];
  for (const [wireId, value] of listed) {
    const id = original(wireId) ?? bad("probability for an unknown option");
    probabilities[id] = probability(value) ?? bad("probability out of range");
  }
  // Some providers report only the chosen option's probability.
  if (listed.length === 0) {
    probabilities[choice] =
      probability(answer.probability ?? answer.confidence) ?? bad("no probabilities");
  }
  if (probabilities[choice] === undefined) bad("no probability for the choice");
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  const slack = 1e-6 + (options?.size ?? 1) * SUM_SLACK_PER_OPTION;
  if (total > 1 + slack) bad("probabilities exceed 1");
  if (options && listed.length === options.size && total < 1 - slack)
    bad("probabilities do not sum to 1");
  const top = Math.max(...Object.values(probabilities));
  if (probabilities[choice]! < top - 1e-6) bad("choice is not the most likely option");
  return {
    type: "choice",
    choice,
    probabilities,
    confidence: probability(answer.confidence) ?? probabilities[choice]!,
  };
}

async function requestOnce(
  config: DecisionModelConfig,
  provider: DecisionProvider,
  state: JsonValue,
  questions: Record<string, DecisionQuestion>,
): Promise<Omit<DecisionResponse, "durationMs">> {
  const aliases = prepare(provider, questions);
  const request = provider.encode(config, state, aliases.questions);
  if (!request.url.startsWith("https://")) {
    throw new DecisionRequestError(`${provider.label} apiUrl must be https`);
  }
  const body = JSON.stringify(request.body);
  const breaker = breakerFor(config, provider);
  if (Date.now() < breaker.openUntil) {
    throw new DecisionRequestError(`${provider.label} requests are paused after repeated failures`);
  }
  const failed = () => {
    if (++breaker.failures >= FAILURES_TO_OPEN) {
      breaker.openUntil = Date.now() + OUTAGE_BREAKER_MS;
      breaker.failures = 0;
    }
  };

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    let responseBody: string;
    try {
      config.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(provider.defaultTimeoutMs);
      response = await fetch(request.url, {
        signal: config.signal ? AbortSignal.any([config.signal, timeout]) : timeout,
        method: "POST",
        headers: request.headers,
        body,
      });
      responseBody = await response.text();
      config.signal?.throwIfAborted();
      timeout.throwIfAborted();
    } catch (error) {
      config.signal?.throwIfAborted();
      failed();
      const cause = error instanceof Error ? error.name : "network";
      throw new DecisionRequestError(
        cause === "TimeoutError"
          ? `${provider.label} decision request timed out after ${provider.defaultTimeoutMs} ms`
          : `${provider.label} decision request failed (${cause})`,
      );
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = JSON.parse(responseBody);
      } catch {
        // Intermediaries can return HTML or truncated JSON with a successful status.
      }
      const decoded = provider.decode(payload);
      if (!decoded) {
        failed();
        throw new DecisionRequestError(
          `${provider.label} response was not a decision payload`,
          response.status,
        );
      }
      config.recordDecisionUsage?.({
        ...decoded.usage,
        provider: provider.name,
        model: decoded.model || config.model || provider.defaultModel,
      });
      const answers: Record<string, DecisionAnswer> = Object.create(null);
      try {
        for (const [wireKey, key] of aliases.keyOf) {
          answers[key] = validate(
            provider,
            key,
            questions[key]!,
            Object.hasOwn(decoded.answers, wireKey) ? decoded.answers[wireKey] : undefined,
            aliases.optionOf.get(key),
            state,
          );
        }
      } catch (error) {
        failed();
        throw error;
      }
      breaker.failures = 0;
      return { model: decoded.model, answers, usage: decoded.usage };
    }

    if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS)
          : 250 * 2 ** (attempt - 1);
      await waitForRetry(wait, config.signal);
      continue;
    }

    if (AUTH_STATUSES.has(response.status)) {
      breaker.openUntil = Date.now() + BREAKER_MS;
      breaker.failures = 0;
    } else if (response.status >= 500 || RETRY_STATUSES.has(response.status)) {
      failed();
    } else {
      // A terminal client error (bad request) is not an outage: it must not
      // let earlier counted failures open the outage breaker later.
      breaker.failures = 0;
    }
    // Only the provider's error code reaches logs, never the raw body.
    const detail = provider.errorCode(responseBody);
    throw new DecisionRequestError(
      `${provider.label} decision request failed (${response.status}${detail ? `: ${detail}` : ""})`,
      response.status,
    );
  }
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function choiceAnswer(response: DecisionResponse, key: string): DecisionChoiceAnswer {
  const answer = response.answers[key];
  if (!answer || !("choice" in answer)) {
    throw new DecisionRequestError(`Decision response is missing choice answer "${key}"`);
  }
  return answer;
}

export function noulAnswer(response: DecisionResponse, key: string): DecisionNoulAnswer {
  const answer = response.answers[key];
  if (!answer || !("noul" in answer)) {
    throw new DecisionRequestError(`Decision response is missing noul answer "${key}"`);
  }
  return answer;
}

export function locateAnswer(response: DecisionResponse, key: string): DecisionLocateAnswer {
  const answer = response.answers[key];
  if (!answer || answer.type !== "locate")
    throw new DecisionRequestError(`Decision response is missing locate answer "${key}"`);
  return answer;
}
