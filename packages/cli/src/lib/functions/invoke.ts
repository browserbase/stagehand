import {
  FunctionsCoreError,
  invokeFunction as invokeFunctionCore,
  parseJsonArgument,
  type InvocationResponse,
} from "@browserbasehq/sdk-functions/core";

import { setRunTelemetryCompletion } from "../run-telemetry.js";
import { rethrowFunctionsCoreError, resolveFunctionsCoreOptions } from "./shared.js";

export interface InvokeFunctionOptions {
  apiKey?: string;
  baseUrl?: string;
  checkStatus?: string;
  functionId?: string;
  noWait: boolean;
  params?: string;
}

export async function invokeFunction(options: InvokeFunctionOptions): Promise<void> {
  try {
    const coreOptions = resolveFunctionsCoreOptions(options);
    const result = await invokeFunctionCore({
      ...coreOptions,
      ...(options.checkStatus ? { checkStatus: options.checkStatus } : {}),
      ...(options.functionId ? { functionId: options.functionId } : {}),
      noWait: options.noWait,
      params: parseJsonArgument(options.params, "params"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof FunctionsCoreError && error.code === "invocation_failed") {
      console.log(JSON.stringify(error.responseBody as InvocationResponse, null, 2));
      setRunTelemetryCompletion({ resultCode: "functions_invocation_failed" });
      process.exitCode = 1;
      return;
    }
    rethrowFunctionsCoreError(error);
  }
}
