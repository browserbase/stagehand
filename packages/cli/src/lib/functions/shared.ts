import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { CommandFailure, fail } from "../errors.js";
import {
  classifyCommandHttpFailure,
  readBrowserbaseError,
  resolveApiKey,
} from "../cloud/api.js";
import { setRunTelemetryCompletion } from "../run-telemetry.js";

const defaultFunctionsBaseUrl = "https://api.browserbase.com";

export interface FunctionsApiConfig {
  apiKey: string;
  baseUrl: string;
}

export interface PollOptions<T> {
  done: (value: T) => boolean;
  intervalMs?: number;
  maxAttempts?: number;
}

export function resolveFunctionsApiConfig(args: {
  apiKey?: string;
  baseUrl?: string;
}): FunctionsApiConfig {
  return {
    apiKey: resolveApiKey(args),
    baseUrl:
      args.baseUrl ||
      process.env.BROWSERBASE_BASE_URL ||
      process.env.BROWSERBASE_API_BASE_URL ||
      defaultFunctionsBaseUrl,
  };
}

export async function functionsRequest(
  config: FunctionsApiConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(new URL(path, config.baseUrl), {
      ...init,
      headers: {
        "x-bb-api-key": config.apiKey,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof CommandFailure) {
      throw error;
    }
    fail(error instanceof Error ? error.message : String(error), 1, {
      resultCode: "request_no_response",
      requestHadHttpResponse: false,
    });
  }

  setRunTelemetryCompletion({
    httpStatus: response.status,
    requestHadHttpResponse: true,
  });

  if (!response.ok) {
    fail(await readBrowserbaseError(response), 1, {
      resultCode: classifyCommandHttpFailure("functions", response.status),
      httpStatus: response.status,
      requestHadHttpResponse: true,
    });
  }

  return response;
}

export async function functionsGet<T>(
  config: FunctionsApiConfig,
  path: string,
): Promise<T> {
  const response = await functionsRequest(config, path);
  return (await response.json()) as T;
}

export async function functionsPost<T>(
  config: FunctionsApiConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await functionsRequest(config, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

export async function pollUntil<T>(
  loader: () => Promise<T>,
  options: PollOptions<T>,
): Promise<T> {
  const intervalMs = options.intervalMs ?? 1_000;
  const maxAttempts = options.maxAttempts ?? 120;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await loader();
    if (options.done(result)) {
      return result;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, intervalMs),
    );
  }

  fail(
    "Timed out while waiting for the Browserbase Functions operation to complete.",
    1,
    { resultCode: "functions_timeout" },
  );
}

export async function resolveEntrypoint(entrypoint: string): Promise<string> {
  const absolutePath = resolve(entrypoint);
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    fail(`Entrypoint file not found: ${absolutePath}`);
  }

  if (!stats.isFile()) {
    fail(`Entrypoint must be a file: ${absolutePath}`);
  }

  const extension = extname(absolutePath).toLowerCase();
  if (
    ![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts"].includes(extension)
  ) {
    fail(`Unsupported entrypoint extension: ${extension}`);
  }

  return absolutePath;
}

export function parseOptionalJsonValueArg(
  rawValue: unknown,
  label: string,
): unknown {
  if (!rawValue) {
    return {};
  }

  if (typeof rawValue !== "string") {
    fail(`${label} must be provided as a JSON string.`);
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    fail(`Invalid JSON for ${label}: ${(error as Error).message}`);
  }
}
