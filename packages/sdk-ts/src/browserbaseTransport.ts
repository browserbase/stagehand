import { validateHeaderName, validateHeaderValue } from "node:http";
import { BrowserbaseRequestParamsSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type {
  BrowserbaseRequestParams,
  BrowserbaseRequestResult,
} from "@browserbasehq/stagehand-protocol/types";
import type { BrowserbaseConnection } from "./browserbaseConnection.js";

const OPERATION_PATHS: Record<BrowserbaseRequestParams["operation"], string> = {
  "gateway.responses": "/llm/responses",
  "cache.get": "/cache/get",
  "cache.set": "/cache/set",
};

// These headers are supplied by the HTTP client or the SDK connection.
const OMITTED_REQUEST_HEADERS = [
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-bb-api-key",
  "x-bb-session-id",
];

function requestHeaders(input: Record<string, string>): Headers {
  for (const [name, value] of Object.entries(input)) {
    validateHeaderName(name);
    validateHeaderValue(name, value);
  }
  const headers = new Headers(input);
  const omitted = new Set([
    ...OMITTED_REQUEST_HEADERS,
    ...(headers.get("connection") ?? "").split(",").map((name) => name.trim().toLowerCase()),
  ]);
  const namesToRemove = [...headers.keys()].filter(
    (name) => omitted.has(name) || name.startsWith("x-forwarded-"),
  );
  for (const name of namesToRemove) headers.delete(name);
  return headers;
}

/** Executes one Browserbase HTTP attempt; the worker interprets the response. */
export async function executeBrowserbaseRequest(
  connection: BrowserbaseConnection | undefined,
  input: BrowserbaseRequestParams,
  callerSignal?: AbortSignal,
): Promise<BrowserbaseRequestResult> {
  const params = BrowserbaseRequestParamsSchema.parse(input);
  if (!connection) {
    return {
      type: "error",
      reason: "unavailable",
      message: "Browserbase connection is unavailable",
    };
  }

  const deadline =
    params.remainingTimeoutMs === undefined
      ? undefined
      : performance.now() + params.remainingTimeoutMs;
  // Construction errors are validation failures, separate from fetch failures.
  let request: Request;
  try {
    const headers = requestHeaders(params.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("x-bb-api-key", connection.apiKey);
    if (params.operation === "gateway.responses") {
      headers.set("x-bb-session-id", connection.sessionId);
      if (!headers.has("authorization"))
        headers.set("authorization", `Bearer ${connection.apiKey}`);
    }
    for (const [name, value] of headers) validateHeaderValue(name, value);
    request = new Request(`${connection.apiUrl}${OPERATION_PATHS[params.operation]}`, {
      method: "POST",
      headers,
      body: params.body,
      redirect: "manual",
    });
  } catch {
    throw new TypeError("Invalid Browserbase HTTP request");
  }
  const timeoutController = new AbortController();
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (deadline !== undefined) {
    const tick = () => {
      const remaining = deadline - performance.now();
      if (remaining > 0) {
        timer = setTimeout(tick, Math.min(2_147_483_647, Math.ceil(remaining)));
      } else {
        timeoutController.abort(new DOMException("Browserbase request timed out", "TimeoutError"));
      }
    };
    tick();
  }

  try {
    signal.throwIfAborted();
    const response = await fetch(request, { signal });
    const body = await response.text();
    const responseHeaders = new Headers(response.headers);
    // Native fetch decodes the body; these describe the original transfer bytes.
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    return {
      type: "response",
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(responseHeaders),
      body,
    };
  } catch {
    if (signal.aborted) {
      const timedOut = signal.reason instanceof Error && signal.reason.name === "TimeoutError";
      return {
        type: "error",
        reason: timedOut ? "timeout" : "cancelled",
        message: timedOut ? "Browserbase request timed out" : "Browserbase request cancelled",
      };
    }
    return { type: "error", reason: "network", message: "Browserbase HTTP request failed" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
