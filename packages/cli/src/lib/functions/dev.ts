import { startDevServer, type DevServerHandle } from "@browserbasehq/sdk-functions/core";

import { fail } from "../errors.js";
import { resolveFunctionsCoreOptions, runFunctionsCore } from "./shared.js";

const DEFAULT_RUNTIME_STARTUP_TIMEOUT_MS = 10_000;

export interface StartFunctionsDevServerOptions {
  apiKey?: string;
  baseUrl?: string;
  entrypoint: string;
  host: string;
  port: number;
  projectId?: string;
  verbose: boolean;
}

export async function startFunctionsDevServer(
  options: StartFunctionsDevServerOptions,
): Promise<void> {
  const coreOptions = resolveFunctionsCoreOptions(options);
  const handle = await runFunctionsCore(() =>
    startDevServer({
      ...coreOptions,
      entrypoint: options.entrypoint,
      host: options.host,
      port: options.port,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      startupTimeoutMs: getRuntimeStartupTimeoutMs(),
      verbose: options.verbose,
      onLog(event) {
        process.stderr.write(`${event.message}\n`);
      },
    }),
  );

  console.log(
    JSON.stringify(
      {
        ok: handle.runtimeConnected,
        runtimeConnected: handle.runtimeConnected,
        url: handle.url,
        ...(!handle.runtimeConnected
          ? {
              warning: [
                "Functions runtime has not connected yet.",
                "Check the runtime logs, then retry once the entrypoint is healthy.",
              ].join(" "),
            }
          : {}),
      },
      null,
      2,
    ),
  );

  installShutdownHandler("SIGINT", handle);
  installShutdownHandler("SIGTERM", handle);
}

function installShutdownHandler(signal: "SIGINT" | "SIGTERM", handle: DevServerHandle): void {
  process.once(signal, () => {
    void handle.close().then(() => process.exit(0));
  });
}

function getRuntimeStartupTimeoutMs(): number {
  const rawValue = process.env.BROWSERBASE_FUNCTIONS_DEV_STARTUP_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_RUNTIME_STARTUP_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("BROWSERBASE_FUNCTIONS_DEV_STARTUP_TIMEOUT_MS must be a non-negative number.");
  }
  return parsed;
}
