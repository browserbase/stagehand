import {
  FunctionsCoreError,
  type ResolveFunctionsApiConfigOptions,
} from "@browserbasehq/sdk-functions/core";

import { classifyCommandHttpFailure, resolveApiKey } from "../cloud/api.js";
import { fail } from "../errors.js";
import { setRunTelemetryCompletion } from "../run-telemetry.js";

export interface FunctionsApiOverrides {
  apiKey?: string;
  baseUrl?: string;
}

export function resolveFunctionsCoreOptions(
  args: FunctionsApiOverrides,
): ResolveFunctionsApiConfigOptions {
  const options: ResolveFunctionsApiConfigOptions = {
    apiKey: resolveApiKey(args),
    onResponse(response) {
      setRunTelemetryCompletion({
        httpStatus: response.status,
        requestHadHttpResponse: true,
      });
    },
  };
  if (args.baseUrl) {
    options.baseUrl = args.baseUrl;
  }
  return options;
}

export async function runFunctionsCore<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowFunctionsCoreError(error);
  }
}

export function rethrowFunctionsCoreError(error: unknown): never {
  if (!(error instanceof FunctionsCoreError)) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const metadata: {
    httpStatus?: number;
    requestHadHttpResponse?: boolean;
    resultCode: string;
  } = {
    resultCode: resultCodeForCoreError(error),
  };
  if (error.httpStatus !== undefined) {
    metadata.httpStatus = error.httpStatus;
    metadata.requestHadHttpResponse = true;
  } else if (error.code === "request_failed") {
    metadata.requestHadHttpResponse = false;
  }
  fail(error.message, 1, metadata);
}

function resultCodeForCoreError(error: FunctionsCoreError): string {
  if (error.code === "http_error" && error.httpStatus !== undefined) {
    return classifyCommandHttpFailure("functions", error.httpStatus) ?? "functions_http_error";
  }
  const codes: Partial<Record<FunctionsCoreError["code"], string>> = {
    build_failed: "functions_build_failed",
    build_missing_id: "functions_build_missing_id",
    invocation_failed: "functions_invocation_failed",
    request_failed: "request_no_response",
    timeout: "functions_timeout",
  };
  return codes[error.code] ?? `functions_${error.code}`;
}
