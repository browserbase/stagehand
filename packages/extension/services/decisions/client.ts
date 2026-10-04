/**
 * One client for every decision-model provider (see providers.ts for the
 * wire formats). Raw fetch rather than vendor SDKs: this runs inside the
 * extension service worker.
 *
 * What is shared here, so each provider behaves the same to the pipeline:
 * request timeout, retry on overload, a circuit breaker per endpoint + key,
 * splitting requests that exceed a provider's question limit, aliasing ids a
 * provider would reject, and validating every answer before it is trusted.
 */
import {
  providerFor,
  type DecisionAnswer,
  type DecisionChoiceAnswer,
  type DecisionModelConfig,
  type DecisionNoulAnswer,
  type DecisionProvider,
  type DecisionQuestion,
  type JsonValue,
} from "./providers.js";

export {
  DECISION_PROVIDERS,
  TYPESAFE_DEFAULT_API_URL,
  TYPESAFE_DEFAULT_MODEL,
  type DecisionAnswer,
  type DecisionChoiceAnswer,
  type DecisionModelConfig,
  type DecisionNoulAnswer,
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
  const startedAt = Date.now();
  // A choice among one option has one possible answer (a softmax over one
  // option is 1). Providers reject or waste tokens on it, so it never leaves.
  const settled: Record<string, DecisionAnswer> = {};
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
  const keys = Object.keys(questions).filter((key) => !(key in settled));
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

  // Every chunk sees the same state; the answers are independent per question.
  const parts = await Promise.all(
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
    answers: Object.assign({}, settled, ...parts.map((part) => part.answers)) as Record<
      string,
      DecisionAnswer
    >,
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
  const prepared: Record<string, DecisionQuestion> = {};
  const flatten = (value: JsonValue): JsonValue => (provider.structuredText ? value : text(value));
  let index = 0;
  for (const [key, question] of Object.entries(questions)) {
    const wireKey = provider.safeId.test(key) ? key : `q${index}`;
    index++;
    keyOf.set(wireKey, key);
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
    const criteria: Record<string, JsonValue> = {};
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
): DecisionAnswer {
  const bad = (why: string): never => {
    throw new DecisionRequestError(
      `${provider.label} returned an invalid answer for "${key}" (${why})`,
    );
  };
  const answer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : bad("missing");
  if (question.type === "noul") {
    const noul = probability(answer.noul ?? answer.probability);
    return { type: "noul", noul: noul ?? bad("noul out of range") };
  }
  const original = (wireId: unknown): string | undefined =>
    typeof wireId === "string" ? options?.get(wireId) : undefined;
  const choice = original(answer.choice) ?? bad("choice is not one of the options");
  const probabilities: Record<string, number> = {};
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
    try {
      response = await fetch(request.url, {
        signal: AbortSignal.timeout(provider.defaultTimeoutMs),
        method: "POST",
        headers: request.headers,
        body,
      });
    } catch (error) {
      failed();
      const cause = error instanceof Error ? error.name : "network";
      throw new DecisionRequestError(
        cause === "TimeoutError"
          ? `${provider.label} decision request timed out after ${provider.defaultTimeoutMs} ms`
          : `${provider.label} decision request failed (${cause})`,
      );
    }

    if (response.ok) {
      // A 2xx with a body that is not the documented shape (an intermediary's
      // HTML, a truncated response) or with answers that do not fit the
      // questions must surface as a typed error, not as something the
      // pipeline acts on. It also counts as a failure: a provider returning
      // nonsense is an outage too.
      const decoded = provider.decode(await response.json().catch(() => undefined));
      if (!decoded) {
        failed();
        throw new DecisionRequestError(
          `${provider.label} response was not a decision payload`,
          response.status,
        );
      }
      const answers: Record<string, DecisionAnswer> = {};
      try {
        for (const [wireKey, key] of aliases.keyOf) {
          answers[key] = validate(
            provider,
            key,
            questions[key]!,
            decoded.answers[wireKey],
            aliases.optionOf.get(key),
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
      await new Promise((resolve) => setTimeout(resolve, wait));
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
    const detail = provider.errorCode(await response.text().catch(() => ""));
    throw new DecisionRequestError(
      `${provider.label} decision request failed (${response.status}${detail ? `: ${detail}` : ""})`,
      response.status,
    );
  }
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
