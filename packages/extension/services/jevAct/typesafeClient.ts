/**
 * Minimal client for TypeSafe's System One endpoint (`POST /v1/systemone`).
 * Raw fetch rather than @typesafe-ai/sdk: the SDK targets Node 20+ and this
 * code runs inside the extension service worker.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JevQuestion =
  | { type: "choice"; instructions: JsonValue; criteria: Record<string, JsonValue> }
  | { type: "noul"; instructions: JsonValue; criteria?: { true: JsonValue; false: JsonValue } };

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JevNoulAnswer = { type: "noul"; noul: number };

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

export type JevConfig = { apiKey: string; model?: string; apiUrl?: string };

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
};

export const JEV_DEFAULT_API_URL = "https://api.typesafe.ai";
export const JEV_DEFAULT_MODEL = "jev-latest";

const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 8_000;
const AUTH_STATUSES = new Set([401, 403]);
const BREAKER_MS = 60_000;

const FAILURES_TO_OPEN = 3;
const OUTAGE_BREAKER_MS = 30_000;

// A bad key, exhausted quota, or a TypeSafe outage fails every act the same
// way; skip Jev for a while instead of paying a doomed (up to 8 s) round trip
// before each LLM fallback. Keyed by endpoint + key so one tenant's bad key
// does not pause another's in a shared worker.
const breakers = new Map<string, { openUntil: number; failures: number }>();

function breakerFor(config: JevConfig) {
  const key = `${config.apiUrl ?? JEV_DEFAULT_API_URL}\u0000${config.apiKey}`;
  let breaker = breakers.get(key);
  if (!breaker) breakers.set(key, (breaker = { openUntil: 0, failures: 0 }));
  return breaker;
}

export class JevRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevRequestError";
  }
}

export async function systemOne(
  config: JevConfig,
  state: JsonValue,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  const url = `${(config.apiUrl ?? JEV_DEFAULT_API_URL).replace(/\/+$/, "")}/v1/systemone`;
  const body = JSON.stringify({ state, model: config.model ?? JEV_DEFAULT_MODEL, questions });
  const startedAt = Date.now();
  const breaker = breakerFor(config);
  if (startedAt < breaker.openUntil) {
    throw new JevRequestError("TypeSafe requests are paused after repeated failures");
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
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (error) {
      failed();
      throw new JevRequestError(
        `TypeSafe systemone request failed (${error instanceof Error ? error.name : "network"})`,
      );
    }

    if (response.ok) {
      breaker.failures = 0;
      const payload = (await response.json()) as {
        model: string;
        answers: Record<string, JevAnswer>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        model: payload.model,
        answers: payload.answers,
        usage: {
          inputTokens: payload.usage?.input_tokens ?? 0,
          outputTokens: payload.usage?.output_tokens ?? 0,
        },
        durationMs: Date.now() - startedAt,
      };
    }

    if (RETRY_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      continue;
    }

    if (AUTH_STATUSES.has(response.status)) breaker.openUntil = Date.now() + BREAKER_MS;
    else if (response.status >= 500 || RETRY_STATUSES.has(response.status)) failed();
    // Only the vendor's error code reaches logs, never the raw body.
    const detail = (await response.text().catch(() => "")).match(
      /"error_type"\s*:\s*"([\w-]{1,64})"/,
    );
    throw new JevRequestError(
      `TypeSafe systemone request failed (${response.status}${detail ? `: ${detail[1]}` : ""})`,
      response.status,
    );
  }
}

export function choiceAnswer(response: JevResponse, key: string): JevChoiceAnswer {
  const answer = response.answers[key];
  if (!answer || !("choice" in answer)) {
    throw new JevRequestError(`TypeSafe response is missing choice answer "${key}"`);
  }
  return answer;
}

export function noulAnswer(response: JevResponse, key: string): JevNoulAnswer {
  const answer = response.answers[key];
  if (!answer || !("noul" in answer)) {
    throw new JevRequestError(`TypeSafe response is missing noul answer "${key}"`);
  }
  return answer;
}
