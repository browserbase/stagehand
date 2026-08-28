import {
  FunctionsCoreError,
  publishFunction as publishFunctionCore,
  type BuildStatusResponse,
} from "@browserbasehq/sdk-functions/core";

import { setRunTelemetryCompletion } from "../run-telemetry.js";
import {
  rethrowFunctionsCoreError,
  resolveFunctionsCoreOptions,
} from "./shared.js";

export interface PublishFunctionOptions {
  apiKey?: string;
  baseUrl?: string;
  dryRun: boolean;
  entrypoint: string;
  projectId?: string;
}

export async function publishFunction(
  options: PublishFunctionOptions,
): Promise<void> {
  try {
    const coreOptions = resolveFunctionsCoreOptions(options);
    const result = await publishFunctionCore({
      ...coreOptions,
      dryRun: options.dryRun,
      entrypoint: options.entrypoint,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    });

    if (result.dryRun) {
      console.log(
        JSON.stringify(
          {
            archivePath: null,
            ...result,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(JSON.stringify(result.build, null, 2));
  } catch (error) {
    if (error instanceof FunctionsCoreError && error.code === "build_failed") {
      console.log(
        JSON.stringify(error.responseBody as BuildStatusResponse, null, 2),
      );
      setRunTelemetryCompletion({ resultCode: "functions_build_failed" });
      process.exitCode = 1;
      return;
    }
    rethrowFunctionsCoreError(error);
  }
}
