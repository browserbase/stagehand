/**
 * Minimal client for TypeSafe's System One endpoint (`POST /v1/systemone`),
 * ported from `packages/extension/services/jevAct/typesafeClient.ts` because
 * the extension package publishes no entry point to import it from.
 *
 * Jev is a System One model: it answers typed questions — Choice (pick one of a
 * closed set, with probabilities) and Noul (a 0..1 score) — in roughly 100-300ms.
 * It cannot generate text, which is why every value this agent types has to be
 * lifted from the goal rather than written by the model.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JevNoulAnswer = { type: "noul"; noul: number };

export type JevConfig = { apiKey: string; model?: string; apiUrl?: string };

export type JevResponse = {
  model: string;
  answers: Record<string, JevChoiceAnswer | JevNoulAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
};

const DEFAULT_API_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const RETRY_STATUSES = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 8_000;

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
  const url = `${(config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")}/v1/systemone`;
  const body = JSON.stringify({ state, model: config.model ?? DEFAULT_MODEL, questions });
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body,
      });
    } catch (error) {
      throw new JevRequestError(
        `TypeSafe systemone request failed (${error instanceof Error ? error.name : "network"})`,
      );
    }

    if (response.ok) {
      const payload = (await response.json()) as {
        model: string;
        answers: Record<string, JevChoiceAnswer | JevNoulAnswer>;
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
